import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';

import { ProcessingOrb } from './src/components/ProcessingOrb';
import { createReading, uploadReportImage } from './src/services/readingApi';
import { colors, gradients } from './src/theme';
import { PalmReading, SelectedPalm } from './src/types';

type Screen = 'name' | 'palm' | 'camera' | 'review' | 'processing' | 'result';

type EntranceAnimationStyle = {
  opacity: Animated.Value;
  transform: { translateY: Animated.AnimatedInterpolation<number> }[];
};

const defaultDisclaimer =
  'This is an AI-predicted interpretation for reflection and entertainment only. It is not a fact, diagnosis, or professional advice, and is never meant to harm you.';

const PALM_FRAME_RATIO = 0.78;
const PALM_FRAME_COVERAGE = 0.72;

type FrameRect = { x: number; y: number; width: number; height: number };

const sectionIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  'life line': 'leaf-outline',
  personality: 'sparkles-outline',
  'heart line': 'heart-outline',
  relationships: 'heart-outline',
  'head line': 'bulb-outline',
  mindset: 'bulb-outline',
  career: 'briefcase-outline',
  'career path': 'briefcase-outline',
  guidance: 'compass-outline',
  future: 'compass-outline',
};

function sectionIcon(label: string): keyof typeof Ionicons.glyphMap {
  return sectionIcons[label.toLowerCase()] || 'sparkles-outline';
}

function reportScore(readingId: string, salt: number) {
  let value = salt * 47;
  for (const character of readingId) value = (value * 31 + character.charCodeAt(0)) % 997;
  return 68 + (value % 27);
}

function getAsset(asset: ImagePicker.ImagePickerAsset): SelectedPalm {
  return {
    uri: asset.uri,
    name: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
  };
}

async function cropToPalmFrame(
  source: { uri: string; width: number; height: number },
  viewport: FrameRect | null,
  frame: FrameRect | null,
): Promise<SelectedPalm> {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  let cropWidth: number;
  let cropHeight: number;
  let originX: number;
  let originY: number;

  if (viewport && frame && viewport.width > 0 && viewport.height > 0) {
    // CameraView uses a cover-style preview. Map the visible guide rectangle
    // back into the full-resolution photo so only the framed palm is retained.
    const previewScale = Math.max(viewport.width / sourceWidth, viewport.height / sourceHeight);
    const previewWidth = sourceWidth * previewScale;
    const previewHeight = sourceHeight * previewScale;
    const offsetX = (viewport.width - previewWidth) / 2;
    const offsetY = (viewport.height - previewHeight) / 2;

    originX = Math.floor((frame.x - offsetX) / previewScale);
    originY = Math.floor((frame.y - offsetY) / previewScale);
    cropWidth = Math.floor(frame.width / previewScale);
    cropHeight = Math.floor(frame.height / previewScale);
  } else {
    // A safe fallback for a camera implementation that cannot report layout.
    const sourceRatio = sourceWidth / sourceHeight;
    const frameWidth = sourceRatio > PALM_FRAME_RATIO ? sourceHeight * PALM_FRAME_RATIO : sourceWidth;
    const frameHeight = sourceRatio > PALM_FRAME_RATIO ? sourceHeight : sourceWidth / PALM_FRAME_RATIO;
    cropWidth = Math.floor(frameWidth * PALM_FRAME_COVERAGE);
    cropHeight = Math.floor(frameHeight * PALM_FRAME_COVERAGE);
    originX = Math.floor((sourceWidth - cropWidth) / 2);
    originY = Math.floor((sourceHeight - cropHeight) / 2);
  }

  cropWidth = Math.max(1, Math.min(cropWidth, sourceWidth));
  cropHeight = Math.max(1, Math.min(cropHeight, sourceHeight));
  originX = Math.max(0, Math.min(originX, sourceWidth - cropWidth));
  originY = Math.max(0, Math.min(originY, sourceHeight - cropHeight));

  const context = ImageManipulator.manipulate(source.uri);
  context.crop({ originX, originY, width: cropWidth, height: cropHeight });
  const rendered = await context.renderAsync();
  const cropped = await rendered.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });

  return {
    uri: cropped.uri,
    name: `palm-${Date.now()}.jpg`,
    mimeType: 'image/jpeg',
    width: cropped.width,
    height: cropped.height,
  };
}

function App() {
  const [screen, setScreen] = useState<Screen>('name');
  const [name, setName] = useState('');
  const [palm, setPalm] = useState<SelectedPalm | null>(null);
  const [reading, setReading] = useState<PalmReading | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');
  const [pendingPalm, setPendingPalm] = useState<SelectedPalm | null>(null);
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    entrance.setValue(0);
    Animated.timing(entrance, { toValue: 1, duration: 480, useNativeDriver: true }).start();
  }, [entrance, screen]);

  const contentEntrance = useMemo(
    () => ({
      opacity: entrance,
      transform: [
        {
          translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
        },
      ],
    }),
    [entrance],
  );

  const chooseImage = useCallback(async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.86,
    });

    if (!result.canceled && result.assets[0]) {
      setPalm(getAsset(result.assets[0]));
    }
  }, []);

  const openCamera = useCallback(() => {
    setError(null);
    setPendingPalm(null);
    setScreen('camera');
  }, []);

  const continueToPalm = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Add your name so we can personalize your reading.');
      return;
    }
    setError(null);
    setScreen('palm');
  }, [name]);

  const beginReading = useCallback(async () => {
    const trimmedName = name.trim();
    if (!palm) {
      setError('Choose or take a clear photo of your palm first.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    setScreen('processing');

    try {
      const response = await createReading(trimmedName, palm);
      setReading(response);
      setScreen('result');
    } catch (caught) {
      setScreen('palm');
      setError(caught instanceof Error ? caught.message : 'Unable to create a reading. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [name, palm]);

  const reset = useCallback(() => {
    setScreen('name');
    setName('');
    setPalm(null);
    setPendingPalm(null);
    setReading(null);
    setError(null);
  }, []);

  return (
    <LinearGradient colors={gradients.page} style={styles.app}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={[styles.safeArea, Platform.OS === 'web' && styles.webSafeArea]}>
        {screen === 'name' && (
          <NameScreen
            name={name}
            error={error}
            entrance={contentEntrance}
            onNameChange={setName}
            onContinue={continueToPalm}
          />
        )}
        {screen === 'palm' && (
          <PalmScreen
            palm={palm}
            error={error}
            isSubmitting={isSubmitting}
            entrance={contentEntrance}
            onChooseImage={chooseImage}
            onTakePhoto={openCamera}
            onRemovePhoto={() => setPalm(null)}
            onSubmit={beginReading}
            onBack={() => {
              setError(null);
              setScreen('name');
            }}
          />
        )}
        {screen === 'camera' && (
          <CameraScreen
            facing={cameraFacing}
            onToggleFacing={() => setCameraFacing((current) => (current === 'back' ? 'front' : 'back'))}
            onClose={() => setScreen('palm')}
            onCapture={(asset) => {
              setPendingPalm(asset);
              setScreen('review');
            }}
          />
        )}
        {screen === 'review' && pendingPalm && (
          <PhotoReviewScreen
            palm={pendingPalm}
            onRetake={() => {
              setPendingPalm(null);
              setScreen('camera');
            }}
            onUsePhoto={() => {
              setPalm(pendingPalm);
              setPendingPalm(null);
              setError(null);
              setScreen('palm');
            }}
          />
        )}
        {screen === 'processing' && <ProcessingScreen name={name.trim()} entrance={contentEntrance} />}
        {screen === 'result' && reading && (
          <ResultScreen reading={reading} entrance={contentEntrance} onHome={reset} />
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

type NameScreenProps = {
  name: string;
  error: string | null;
  entrance: EntranceAnimationStyle;
  onNameChange: (value: string) => void;
  onContinue: () => void;
};

function NameScreen({ name, error, entrance, onNameChange, onContinue }: NameScreenProps) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.flex, entrance]}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Ionicons name="sparkles" size={15} color={colors.ink} />
            </View>
            <Text style={styles.brandText}>PALMORA</Text>
            <View style={styles.brandPill}>
              <View style={styles.liveDot} />
              <Text style={styles.brandPillText}>AI reading</Text>
            </View>
          </View>

          <View style={styles.stepTrack} accessibilityLabel="Step 1 of 2">
            <View style={[styles.stepDot, styles.stepDotActive]} />
            <View style={styles.stepLine} />
            <View style={styles.stepDot} />
            <Text style={styles.stepText}>STEP 1 OF 2</Text>
          </View>

          <View style={styles.hero}>
            <Text style={styles.eyebrow}>YOUR STORY, IN YOUR HAND</Text>
            <Text style={styles.heroTitle}>First, let’s{`\n`}meet you.</Text>
            <Text style={styles.heroSubtitle}>
              Share your name, then we’ll guide you to take a clear photo of your palm.
            </Text>
          </View>

          <LinearGradient colors={gradients.card} style={styles.formCard}>
            <Text style={styles.fieldLabel}>YOUR NAME</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="person-outline" color={colors.lavender} size={20} />
              <TextInput
                value={name}
                onChangeText={(value) => {
                  onNameChange(value);
                }}
                placeholder="What should we call you?"
                placeholderTextColor="#9891B3"
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={70}
                returnKeyType="done"
                onSubmitEditing={onContinue}
                style={styles.input}
                accessibilityLabel="Your name"
              />
            </View>

            {error && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Ionicons name="alert-circle-outline" color={colors.danger} size={19} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              onPress={onContinue}
              style={({ pressed }) => [styles.submitShadow, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Continue to palm photo"
            >
              <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.submitButton}>
                <Text style={styles.submitText}>Continue</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </LinearGradient>
            </Pressable>
          </LinearGradient>

          <Disclaimer />
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type PalmScreenProps = {
  palm: SelectedPalm | null;
  error: string | null;
  isSubmitting: boolean;
  entrance: EntranceAnimationStyle;
  onChooseImage: () => void;
  onTakePhoto: () => void;
  onRemovePhoto: () => void;
  onSubmit: () => void;
  onBack: () => void;
};

function PalmScreen({
  palm,
  error,
  isSubmitting,
  entrance,
  onChooseImage,
  onTakePhoto,
  onRemovePhoto,
  onSubmit,
  onBack,
}: PalmScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.formScrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.flex, entrance]}>
          <View style={styles.pageHeader}>
            <Pressable onPress={onBack} style={styles.backButton} accessibilityLabel="Back to name">
              <Ionicons name="arrow-back" color={colors.text} size={21} />
            </Pressable>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <Ionicons name="sparkles" size={15} color={colors.ink} />
              </View>
              <Text style={styles.brandText}>PALMORA</Text>
            </View>
            <View style={styles.brandPill}>
              <View style={styles.liveDot} />
              <Text style={styles.brandPillText}>AI reading</Text>
            </View>
          </View>

          <View style={styles.stepTrack} accessibilityLabel="Step 2 of 2">
            <View style={[styles.stepDot, styles.stepDotActive]} />
            <View style={[styles.stepLine, styles.stepLineActive]} />
            <View style={[styles.stepDot, styles.stepDotActive]} />
            <Text style={styles.stepText}>STEP 2 OF 2</Text>
          </View>

          <View style={styles.compactHero}>
            <Text style={styles.eyebrow}>SHOW US YOUR PALM</Text>
            <Text style={styles.palmTitle}>A clear photo is{`\n`}all we need.</Text>
            <Text style={styles.heroSubtitle}>
              Use natural light, keep your hand open, and make sure the lines are in focus.
            </Text>
          </View>

          <LinearGradient colors={gradients.card} style={styles.formCard}>
            <View style={styles.fieldHeaderNoTop}>
              <Text style={styles.fieldLabel}>PALM PHOTO</Text>
              <Text style={styles.optionalText}>1 photo</Text>
            </View>

            {palm ? (
              <View style={styles.previewWrap}>
                <Image source={{ uri: palm.uri }} style={styles.previewImage} />
                <LinearGradient colors={['transparent', 'rgba(13, 10, 34, 0.92)']} style={styles.previewShade} />
                <View style={styles.previewCopy}>
                  <View style={styles.readyBadge}>
                    <Ionicons name="checkmark-circle" color={colors.mint} size={15} />
                    <Text style={styles.readyBadgeText}>Photo ready</Text>
                  </View>
                  <Text style={styles.previewCaption}>Your palm is ready to read</Text>
                </View>
                <Pressable onPress={onRemovePhoto} hitSlop={8} style={styles.removeButton} accessibilityLabel="Remove palm photo">
                  <Ionicons name="close" size={18} color={colors.text} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.uploadArea}>
                <View style={styles.uploadIconWrap}>
                  <Ionicons name="hand-left-outline" color={colors.lavender} size={34} />
                </View>
                <Text style={styles.uploadTitle}>Show us your palm</Text>
                <Text style={styles.uploadHint}>Use natural light and keep your palm open, centered, and in focus.</Text>
              </View>
            )}

            <View style={styles.photoActions}>
              <Pressable onPress={onChooseImage} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Ionicons name="images-outline" color={colors.text} size={19} />
                <Text style={styles.secondaryButtonText}>{palm ? 'Change photo' : 'Choose photo'}</Text>
              </Pressable>
              <Pressable onPress={onTakePhoto} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} accessibilityLabel="Take palm photo">
                <Ionicons name="camera-outline" color={colors.text} size={22} />
              </Pressable>
            </View>

            {error && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Ionicons name="alert-circle-outline" color={colors.danger} size={19} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              onPress={onSubmit}
              disabled={isSubmitting}
              style={({ pressed }) => [styles.submitShadow, pressed && !isSubmitting && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Reveal my reading"
            >
              <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.submitButton}>
                {isSubmitting ? <ActivityIndicator color="#fff" /> : <Ionicons name="sparkles" size={19} color="#fff" />}
                <Text style={styles.submitText}>{isSubmitting ? 'Preparing your reading…' : 'Reveal my reading'}</Text>
                {!isSubmitting && <Ionicons name="arrow-forward" size={18} color="#fff" />}
              </LinearGradient>
            </Pressable>
          </LinearGradient>

          <View style={styles.formNote}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.mint} />
            <Text style={styles.formNoteText}>Your photo is used to create this reading.</Text>
          </View>
          <Disclaimer />
        </Animated.View>
      </ScrollView>
  );
}

function CameraScreen({
  facing,
  onToggleFacing,
  onClose,
  onCapture,
}: {
  facing: CameraType;
  onToggleFacing: () => void;
  onClose: () => void;
  onCapture: (asset: SelectedPalm) => void;
}) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [cameraViewport, setCameraViewport] = useState<FrameRect | null>(null);
  const [guideFrame, setGuideFrame] = useState<FrameRect | null>(null);
  const [safeAreaRect, setSafeAreaRect] = useState<FrameRect | null>(null);
  const [guideLayout, setGuideLayout] = useState<FrameRect | null>(null);

  useEffect(() => {
    if (!safeAreaRect || !guideLayout) return;
    // Guide layout is relative to SafeAreaView. Add the SafeAreaView's own
    // offset to obtain coordinates relative to the CameraView/root preview.
    setGuideFrame({
      x: safeAreaRect.x + guideLayout.x,
      y: safeAreaRect.y + guideLayout.y,
      width: guideLayout.width,
      height: guideLayout.height,
    });
  }, [guideLayout, safeAreaRect]);

  const capturePalm = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return;

    setCaptureError(null);
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.86 });
      if (!photo?.uri) throw new Error('No photo was captured.');
      onCapture(await cropToPalmFrame(photo, cameraViewport, guideFrame));
    } catch {
      setCaptureError('We could not save that photo. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, onCapture]);

  if (!permission) {
    return (
      <View style={styles.cameraPermissionPage}>
        <ActivityIndicator color={colors.mint} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.cameraPermissionPage}>
        <View style={styles.cameraPermissionCard}>
          <View style={styles.uploadIconWrap}>
            <Ionicons name="camera-outline" color={colors.lavender} size={34} />
          </View>
          <Text style={styles.cameraPermissionTitle}>Camera access needed</Text>
          <Text style={styles.cameraPermissionText}>
            Allow camera access to take a clear photo of your palm.
          </Text>
          <Pressable onPress={requestPermission} style={({ pressed }) => [styles.submitShadow, pressed && styles.pressed]}>
            <LinearGradient colors={gradients.primary} style={styles.submitButton}>
              <Text style={styles.submitText}>Allow camera</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={onClose} style={styles.cameraCancelButton}>
            <Text style={styles.cameraCancelText}>Back to palm photo</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.cameraScreen} onLayout={(event) => setCameraViewport(event.nativeEvent.layout)}>
      <CameraView ref={cameraRef} style={styles.cameraPreview} facing={facing} />
      <LinearGradient colors={['rgba(8, 6, 25, 0.55)', 'transparent', 'rgba(8, 6, 25, 0.82)']} style={styles.cameraShade} />
      <SafeAreaView style={styles.cameraSafeArea} onLayout={(event) => setSafeAreaRect(event.nativeEvent.layout)}>
        <View style={styles.cameraHeader}>
          <Pressable onPress={onClose} style={styles.cameraRoundButton} accessibilityLabel="Close camera">
            <Ionicons name="close" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.cameraHeaderCopy}>
            <Text style={styles.cameraHeaderTitle}>Photograph your palm</Text>
            <Text style={styles.cameraHeaderSubtitle}>Keep your hand open and centered</Text>
          </View>
          <View style={styles.cameraRoundButton}>
            <Ionicons name="hand-left-outline" color={colors.mint} size={21} />
          </View>
        </View>

        <View style={styles.cameraGuide} onLayout={(event) => setGuideLayout(event.nativeEvent.layout)}>
          <View style={styles.cameraGuideCorner} />
          <Text style={styles.cameraGuideText}>Place your palm inside the frame</Text>
        </View>

        <View style={styles.cameraControls}>
          {captureError && <Text style={styles.cameraErrorText}>{captureError}</Text>}
          <Pressable onPress={onToggleFacing} style={styles.cameraFlipButton} accessibilityLabel="Switch front or back camera">
            <Ionicons name="camera-reverse-outline" color={colors.text} size={21} />
            <Text style={styles.cameraFlipText}>{facing === 'back' ? 'Back camera' : 'Front camera'}</Text>
          </Pressable>
          <Pressable
            onPress={capturePalm}
            disabled={isCapturing}
            style={({ pressed }) => [styles.shutterButton, pressed && styles.shutterButtonPressed]}
            accessibilityLabel="Capture palm photo"
          >
            {isCapturing ? <ActivityIndicator color={colors.ink} /> : <View style={styles.shutterButtonCenter} />}
          </Pressable>
          <Text style={styles.cameraCaptureLabel}>{isCapturing ? 'Saving photo…' : 'Tap to capture'}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

function PhotoReviewScreen({
  palm,
  onRetake,
  onUsePhoto,
}: {
  palm: SelectedPalm;
  onRetake: () => void;
  onUsePhoto: () => void;
}) {
  return (
    <View style={styles.reviewScreen}>
      <SafeAreaView style={styles.reviewSafeArea}>
        <View style={styles.reviewTopBar}>
          <Pressable onPress={onRetake} style={styles.cameraRoundButton} accessibilityLabel="Retake photo">
            <Ionicons name="arrow-back" color={colors.text} size={21} />
          </Pressable>
          <Text style={styles.brandText}>REVIEW PHOTO</Text>
          <View style={styles.cameraRoundButton}>
            <Ionicons name="scan-outline" color={colors.mint} size={21} />
          </View>
        </View>

        <View style={styles.reviewContent}>
          <Text style={styles.eyebrow}>PALM FRAME CAPTURED</Text>
          <Text style={styles.reviewTitle}>Is your palm clear{`\n`}inside the frame?</Text>
          <Text style={styles.reviewSubtitle}>
            Only the focused area inside the guide will be used for your reading.
          </Text>

          <View style={styles.reviewImageWrap}>
            <Image source={{ uri: palm.uri }} style={styles.reviewImage} />
            <View style={styles.reviewImageBadge}>
              <Ionicons name="scan-outline" color={colors.mint} size={15} />
              <Text style={styles.reviewImageBadgeText}>Frame crop</Text>
            </View>
          </View>
        </View>

        <View style={styles.reviewActions}>
          <Pressable onPress={onRetake} style={({ pressed }) => [styles.retakeButton, pressed && styles.pressed]}>
            <Ionicons name="refresh-outline" color={colors.text} size={20} />
            <Text style={styles.retakeButtonText}>Retake</Text>
          </Pressable>
          <Pressable onPress={onUsePhoto} style={({ pressed }) => [styles.reviewUseButton, pressed && styles.pressed]}>
            <LinearGradient colors={gradients.primary} style={styles.submitButton}>
              <Text style={styles.submitText}>Use this photo</Text>
              <Ionicons name="checkmark" color="#fff" size={19} />
            </LinearGradient>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function ProcessingScreen({ name, entrance }: { name: string; entrance: EntranceAnimationStyle }) {
  return (
    <Animated.View style={[styles.processing, entrance]}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <Ionicons name="sparkles" size={15} color={colors.ink} />
        </View>
        <Text style={styles.brandText}>PALMORA</Text>
      </View>
      <View style={styles.processingContent}>
        <Text style={styles.eyebrow}>READING YOUR UNIQUE LINES</Text>
        <ProcessingOrb />
        <Text style={styles.processingTitle}>Finding the patterns{`\n`}in your palm…</Text>
        <Text style={styles.processingSubtitle}>
          {name ? `A little moment, ${name}.` : 'A little moment.'} Our AI is considering the shape, lines, and details in your photo.
        </Text>
        <View style={styles.analyzingPill}>
          <ActivityIndicator size="small" color={colors.mint} />
          <Text style={styles.analyzingText}>Analyzing your palm</Text>
        </View>
      </View>
      <Disclaimer compact />
    </Animated.View>
  );
}

function ResultScreen({
  reading,
  entrance,
  onHome,
}: {
  reading: PalmReading;
  entrance: EntranceAnimationStyle;
  onHome: () => void;
}) {
  const imageUri = reading.imageUrl;
  const shownSections = reading.sections.filter((section) => section.insight?.trim()).slice(0, 6);
  const reportRef = useRef<View>(null);
  const capturedOnce = useRef(false);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [reportSaved, setReportSaved] = useState(Boolean(reading.reportImageUrl));
  const [reportError, setReportError] = useState<string | null>(null);
  const scores = [
    { label: 'Love', icon: 'heart' as const, color: '#F07CB5', value: reportScore(reading.id, 1) },
    { label: 'Career', icon: 'briefcase' as const, color: '#F7C65A', value: reportScore(reading.id, 2) },
    { label: 'Energy', icon: 'leaf' as const, color: '#77D9A2', value: reportScore(reading.id, 3) },
    { label: 'Intuition', icon: 'moon' as const, color: '#BE8BF4', value: reportScore(reading.id, 4) },
  ];

  const saveReport = useCallback(async () => {
    if (!reportRef.current || isSavingReport || reportSaved) return;

    setReportError(null);
    setIsSavingReport(true);
    try {
      let uri: string;
      if (Platform.OS === 'web') {
        const { toJpeg } = await import('html-to-image');
        uri = await toJpeg(reportRef.current as unknown as HTMLElement, {
          backgroundColor: '#0D092A',
          quality: 0.9,
          pixelRatio: 2,
        });
      } else {
        uri = await captureRef(reportRef, { format: 'jpg', quality: 0.9, result: 'tmpfile' });
      }
      await uploadReportImage(reading.id, {
        uri,
        name: `palm-reading-report-${reading.id}.jpg`,
        mimeType: 'image/jpeg',
      });
      setReportSaved(true);
    } catch {
      setReportError('We could not save the report image yet. Please tap Save report to retry.');
    } finally {
      setIsSavingReport(false);
    }
  }, [isSavingReport, reading.id, reportSaved]);

  useEffect(() => {
    if (capturedOnce.current || reportSaved) return;
    capturedOnce.current = true;
    const timer = setTimeout(() => void saveReport(), 1200);
    return () => clearTimeout(timer);
  }, [reportSaved, saveReport]);

  return (
    <ScrollView contentContainerStyle={styles.resultScrollContent} showsVerticalScrollIndicator={false}>
      <Animated.View style={entrance}>
        <View style={styles.resultTopBar}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Ionicons name="sparkles" size={15} color={colors.ink} />
            </View>
            <Text style={styles.brandText}>PALMORA</Text>
          </View>
          <Pressable onPress={onHome} hitSlop={10} style={styles.homeIcon} accessibilityLabel="Return home">
            <Ionicons name="home-outline" color={colors.text} size={21} />
          </Pressable>
        </View>

        <View ref={reportRef} collapsable={false} style={styles.reportPoster}>
          <LinearGradient colors={['#1B0D45', '#090821', '#19113D']} style={StyleSheet.absoluteFill} />
          <View style={styles.reportStarOne} />
          <View style={styles.reportStarTwo} />
          <Text style={styles.reportKicker}>PALMORA PRESENTS</Text>
          <Text style={styles.reportHeading}>Palm Reading Result</Text>
          <Text style={styles.reportSubheading}>A playful reflection from your unique lines</Text>

          <View style={styles.reportTabs}>
            <View style={[styles.reportTab, styles.reportTabActive]}>
              <Text style={[styles.reportTabText, styles.reportTabTextActive]}>Overview</Text>
            </View>
          </View>

          <View style={styles.reportHero}>
            {imageUri ? <Image source={{ uri: imageUri }} style={styles.reportPalmImage} /> : <View style={styles.resultPalmImageFallback} />}
            <LinearGradient colors={['rgba(7, 4, 25, 0.07)', 'rgba(7, 4, 25, 0.64)']} style={StyleSheet.absoluteFill} />
            <View style={styles.resultHeroCopy}>
              <View style={styles.completeBadge}>
                <Ionicons name="sparkles" color="#F9D16E" size={14} />
                <Text style={styles.completeBadgeText}>Reflection complete</Text>
              </View>
              <Text style={styles.resultGreeting}>Hello, {reading.name || 'there'}</Text>
              <Text style={styles.resultTitle}>{reading.title || 'Your palm’s story'}</Text>
            </View>
          </View>

          <View style={styles.reportTwoColumn}>
            <View style={styles.reportSmallCard}>
              <Text style={styles.reportCardKicker}>YOUR PALM PROFILE</Text>
              <Text style={styles.reportProfileTitle}>A moment for reflection</Text>
              <Text style={styles.reportProfileText}>Your hand image is a creative starting point, not a factual assessment.</Text>
            </View>
            <View style={styles.reportSmallCard}>
              <Text style={styles.reportCardKicker}>OVERALL READING</Text>
              <Ionicons name="eye-outline" color="#F9D16E" size={26} style={styles.reportEye} />
              <Text style={styles.reportProfileText}>{reading.overview}</Text>
            </View>
          </View>

          <View style={styles.reportScoreCard}>
            <View style={styles.reportSectionTitleRow}>
              <Ionicons name="sparkles" color="#F9D16E" size={16} />
              <Text style={styles.reportSectionTitle}>Reflection themes</Text>
            </View>
            {scores.map((score) => (
              <View key={score.label} style={styles.reportScoreRow}>
                <Ionicons name={score.icon} color={score.color} size={15} />
                <Text style={styles.reportScoreLabel}>{score.label}</Text>
                <View style={styles.reportScoreTrack}><View style={[styles.reportScoreFill, { width: `${score.value}%`, backgroundColor: score.color }]} /></View>
                <Text style={[styles.reportScoreValue, { color: score.color }]}>{score.value}%</Text>
              </View>
            ))}
            <Text style={styles.reportScoreNote}>Visual cues for entertainment only—not a measurement of you.</Text>
          </View>

          <Text style={styles.reportDetailsHeading}>Your line-by-line reflection</Text>
          {shownSections.map((section, index) => (
            <LinearGradient key={`${section.id}-${index}`} colors={['rgba(44, 29, 94, 0.91)', 'rgba(18, 13, 56, 0.95)']} style={styles.reportInsightCard}>
              <View style={styles.insightIcon}>
                <Ionicons name={sectionIcon(section.label)} color="#F6C878" size={21} />
              </View>
              <View style={styles.insightContent}>
                <Text style={styles.insightLabel}>{section.label}</Text>
                <Text style={styles.insightText}>{section.insight}</Text>
              </View>
            </LinearGradient>
          ))}

          {!!reading.affirmation && (
            <LinearGradient colors={['rgba(247, 197, 94, 0.2)', 'rgba(190, 122, 246, 0.18)']} style={styles.reportQuoteCard}>
              <Ionicons name="sparkles" color="#F9D16E" size={19} />
              <Text style={styles.reportQuote}>{reading.affirmation}</Text>
            </LinearGradient>
          )}

          <Disclaimer text={reading.disclaimer || defaultDisclaimer} />
          <Text style={styles.reportFooter}>PALMORA · FOR REFLECTION & ENTERTAINMENT ONLY</Text>
        </View>

        <View style={styles.reportSaveStatus}>
          {reportSaved ? <Ionicons name="cloud-done-outline" color={colors.mint} size={18} /> : <Ionicons name="cloud-upload-outline" color={colors.lavender} size={18} />}
          <Text style={styles.reportSaveStatusText}>{reportSaved ? 'Full report image saved securely to Cloudinary' : isSavingReport ? 'Saving your full report image…' : 'Your report image is ready to save'}</Text>
        </View>
        {reportError && <Text style={styles.reportSaveError}>{reportError}</Text>}
        {!reportSaved && (
          <Pressable onPress={() => void saveReport()} disabled={isSavingReport} style={({ pressed }) => [styles.saveReportButton, pressed && !isSavingReport && styles.pressed]}>
            <LinearGradient colors={['#F8CA65', '#D47CC8']} style={styles.submitButton}>
              {isSavingReport ? <ActivityIndicator color={colors.ink} /> : <Ionicons name="cloud-upload-outline" size={19} color={colors.ink} />}
              <Text style={[styles.submitText, styles.saveReportText]}>{isSavingReport ? 'Saving report…' : 'Save report to Cloudinary'}</Text>
            </LinearGradient>
          </Pressable>
        )}

        <Pressable onPress={onHome} style={({ pressed }) => [styles.submitShadow, pressed && styles.pressed]} accessibilityRole="button">
          <LinearGradient colors={gradients.primary} style={styles.submitButton}>
            <Ionicons name="home-outline" size={19} color="#fff" />
            <Text style={styles.submitText}>Back to home</Text>
          </LinearGradient>
        </Pressable>
        <Text style={styles.footnote}>Every hand is unique. Take what resonates and leave the rest.</Text>
      </Animated.View>
    </ScrollView>
  );
}

function Disclaimer({ text = defaultDisclaimer, compact = false }: { text?: string; compact?: boolean }) {
  return (
    <View style={[styles.disclaimer, compact && styles.disclaimerCompact]}>
      <Ionicons name="information-circle-outline" color={colors.warning} size={compact ? 16 : 19} />
      <Text style={[styles.disclaimerText, compact && styles.disclaimerTextCompact]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  safeArea: { flex: 1 },
  webSafeArea: { width: '100%', maxWidth: 920, alignSelf: 'center' },
  flex: { flex: 1 },
  cameraScreen: { flex: 1, backgroundColor: '#080619' },
  cameraPreview: { ...StyleSheet.absoluteFill },
  cameraShade: { ...StyleSheet.absoluteFill },
  reviewScreen: { flex: 1, backgroundColor: colors.ink },
  reviewSafeArea: { flex: 1, paddingHorizontal: 22, paddingBottom: 24 },
  reviewTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  reviewContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 24 },
  reviewTitle: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  reviewSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 11, maxWidth: 315 },
  reviewImageWrap: {
    width: '78%',
    maxWidth: 340,
    aspectRatio: PALM_FRAME_RATIO,
    marginTop: 28,
    overflow: 'hidden',
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.mint,
    backgroundColor: colors.inkSoft,
  },
  reviewImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  reviewImageBadge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(8, 6, 25, 0.76)',
  },
  reviewImageBadgeText: { color: colors.mint, fontSize: 10, fontWeight: '800' },
  reviewActions: { flexDirection: 'row', gap: 10 },
  retakeButton: {
    width: 112,
    minHeight: 56,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  retakeButtonText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  reviewUseButton: { flex: 1, borderRadius: 15, overflow: 'hidden' },
  cameraSafeArea: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 28 },
  cameraHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
  cameraRoundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(11, 8, 31, 0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraHeaderCopy: { flex: 1 },
  cameraHeaderTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  cameraHeaderSubtitle: { color: '#E0DBEE', marginTop: 2, fontSize: 11 },
  cameraGuide: {
    alignSelf: 'center',
    width: '76%',
    aspectRatio: 0.78,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  cameraGuideCorner: {
    position: 'absolute',
    top: -3,
    left: -3,
    width: 48,
    height: 48,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: colors.mint,
    borderTopLeftRadius: 25,
  },
  cameraGuideText: { color: '#F9F7FF', fontSize: 12, fontWeight: '700', textShadowColor: '#080619', textShadowRadius: 8 },
  cameraControls: { alignItems: 'center', minHeight: 162 },
  cameraFlipButton: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 99,
    backgroundColor: 'rgba(11, 8, 31, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  cameraFlipText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  shutterButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#FFFFFF',
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.45)',
    marginTop: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterButtonPressed: { transform: [{ scale: 0.92 }], opacity: 0.85 },
  shutterButtonCenter: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.mint },
  cameraCaptureLabel: { color: '#F7F4FF', fontSize: 11, fontWeight: '700', marginTop: 8 },
  cameraErrorText: { color: colors.danger, fontSize: 11, fontWeight: '700', marginBottom: 8 },
  cameraPermissionPage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.ink },
  cameraPermissionCard: {
    width: '100%',
    maxWidth: 390,
    alignItems: 'center',
    padding: 24,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.stroke,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  cameraPermissionTitle: { color: colors.text, fontSize: 21, fontWeight: '800', marginTop: 16 },
  cameraPermissionText: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  cameraCancelButton: { paddingTop: 19, paddingBottom: 2 },
  cameraCancelText: { color: colors.lavender, fontSize: 13, fontWeight: '700' },
  formScrollContent: { width: '100%', maxWidth: 700, alignSelf: 'center', padding: 22, paddingBottom: 34 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: {
    width: 27,
    height: 27,
    borderRadius: 9,
    backgroundColor: '#E4D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { color: colors.text, fontWeight: '800', fontSize: 14, letterSpacing: 2.1 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  brandPill: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mint },
  brandPillText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  stepTrack: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 36 },
  stepDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.24)' },
  stepDotActive: { backgroundColor: colors.mint },
  stepLine: { width: 28, height: 1, backgroundColor: 'rgba(255,255,255,0.19)' },
  stepLineActive: { backgroundColor: colors.mint },
  stepText: { marginLeft: 'auto', color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  hero: { marginTop: 46, marginBottom: 30 },
  compactHero: { marginTop: 34, marginBottom: 26 },
  eyebrow: { color: colors.lavender, fontSize: 10, fontWeight: '800', letterSpacing: 1.6, textAlign: 'center' },
  heroTitle: { color: colors.text, fontSize: 38, lineHeight: 43, fontWeight: '800', letterSpacing: -1.2, marginTop: 11 },
  palmTitle: { color: colors.text, fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.9, marginTop: 11 },
  heroSubtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 14, maxWidth: 335 },
  formCard: {
    padding: 17,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  fieldLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.25 },
  fieldHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 10 },
  fieldHeaderNoTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  optionalText: { color: '#AFA7C8', fontSize: 11, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginTop: 9,
    height: 53,
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: 'rgba(7, 5, 26, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  input: { flex: 1, color: colors.text, fontSize: 15, height: '100%' },
  uploadArea: {
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
    paddingVertical: 22,
    borderWidth: 1,
    borderRadius: 17,
    borderColor: 'rgba(183, 164, 255, 0.38)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(16, 12, 48, 0.26)',
  },
  uploadIconWrap: {
    width: 61,
    height: 61,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(183, 164, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(183, 164, 255, 0.28)',
  },
  uploadTitle: { color: colors.text, marginTop: 12, fontSize: 16, fontWeight: '700' },
  uploadHint: { color: colors.muted, marginTop: 7, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  previewWrap: { height: 210, overflow: 'hidden', borderRadius: 17, backgroundColor: colors.inkSoft },
  previewImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  previewShade: { ...StyleSheet.absoluteFill },
  previewCopy: { position: 'absolute', left: 14, bottom: 14 },
  readyBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  readyBadgeText: { color: colors.mint, fontSize: 11, fontWeight: '800' },
  previewCaption: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 4 },
  removeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 33,
    height: 33,
    borderRadius: 17,
    backgroundColor: 'rgba(12, 8, 34, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoActions: { flexDirection: 'row', gap: 10, marginTop: 11 },
  secondaryButton: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  secondaryButtonText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  iconButton: {
    width: 49,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 13, paddingHorizontal: 2 },
  errorText: { flex: 1, color: colors.danger, lineHeight: 18, fontSize: 12 },
  submitShadow: { marginTop: 19, borderRadius: 15, shadowColor: '#9B7BFF', shadowOpacity: 0.38, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 7 },
  submitButton: { minHeight: 56, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16 },
  submitText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.79, transform: [{ scale: 0.985 }] },
  formNote: { flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center', marginTop: 17 },
  formNoteText: { color: '#BEB8D1', fontSize: 11 },
  disclaimer: { marginTop: 22, padding: 14, borderRadius: 15, flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: 'rgba(255, 210, 137, 0.09)', borderWidth: 1, borderColor: 'rgba(255, 210, 137, 0.18)' },
  disclaimerCompact: { marginHorizontal: 22, marginBottom: 9, marginTop: 0 },
  disclaimerText: { flex: 1, color: '#E6D9BC', fontSize: 11, lineHeight: 17 },
  disclaimerTextCompact: { fontSize: 10, lineHeight: 15 },
  processing: { flex: 1, paddingTop: 12 },
  processingContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 26 },
  processingTitle: { color: colors.text, fontSize: 27, fontWeight: '800', textAlign: 'center', lineHeight: 34, letterSpacing: -0.5, marginTop: 20 },
  processingSubtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 13, maxWidth: 325 },
  analyzingPill: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 99, marginTop: 24, backgroundColor: 'rgba(141, 225, 207, 0.10)', borderWidth: 1, borderColor: 'rgba(141, 225, 207, 0.23)' },
  analyzingText: { color: colors.mint, fontSize: 12, fontWeight: '700' },
  resultScrollContent: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 22, paddingBottom: 36 },
  resultTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  homeIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: colors.stroke, alignItems: 'center', justifyContent: 'center' },
  reportPoster: {
    position: 'relative',
    overflow: 'hidden',
    marginTop: 20,
    padding: 16,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: 'rgba(246, 203, 111, 0.45)',
    backgroundColor: '#0D092A',
  },
  reportStarOne: { position: 'absolute', width: 190, height: 190, borderRadius: 100, top: -95, right: -88, backgroundColor: 'rgba(184, 106, 244, 0.15)' },
  reportStarTwo: { position: 'absolute', width: 130, height: 130, borderRadius: 70, top: 325, left: -75, backgroundColor: 'rgba(46, 116, 228, 0.14)' },
  reportKicker: { color: '#E8C778', textAlign: 'center', fontWeight: '800', fontSize: 9, letterSpacing: 2.1, marginTop: 4 },
  reportHeading: { color: '#FFE7A0', textAlign: 'center', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 6, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  reportSubheading: { color: '#D8CBEF', textAlign: 'center', fontSize: 11, marginTop: 4 },
  reportTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16, marginBottom: 13, justifyContent: 'center' },
  reportTab: { borderWidth: 1, borderColor: 'rgba(219, 172, 255, 0.42)', paddingVertical: 6, paddingHorizontal: 9, borderRadius: 20, backgroundColor: 'rgba(17, 11, 50, 0.55)' },
  reportTabActive: { backgroundColor: '#F6CB73', borderColor: '#FFE3A3' },
  reportTabText: { color: '#DCD4F2', fontWeight: '700', fontSize: 10 },
  reportTabTextActive: { color: '#211337' },
  reportHero: { width: '100%', aspectRatio: PALM_FRAME_RATIO, borderRadius: 20, overflow: 'hidden', backgroundColor: '#38275D', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' },
  reportPalmImage: { width: '100%', height: '100%', resizeMode: 'contain' },
  palmLine: { position: 'absolute', height: 3, borderRadius: 5, left: '19%', right: '15%', opacity: 0.94, shadowColor: '#fff', shadowOpacity: 0.7, shadowRadius: 5 },
  palmLineHeart: { top: '48%', backgroundColor: '#FF75A9', transform: [{ rotate: '-6deg' }] },
  palmLineHead: { top: '60%', backgroundColor: '#75BDFB', transform: [{ rotate: '8deg' }] },
  palmLineLife: { top: '72%', left: '25%', right: '25%', backgroundColor: '#8BE69B', transform: [{ rotate: '-29deg' }] },
  palmMarkerTop: { position: 'absolute', top: '41%', right: 9, backgroundColor: 'rgba(20, 8, 39, 0.76)', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 3 },
  palmMarkerMid: { position: 'absolute', top: '63%', left: 9, backgroundColor: 'rgba(20, 8, 39, 0.76)', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 3 },
  palmMarkerBottom: { position: 'absolute', top: '75%', right: 10, backgroundColor: 'rgba(20, 8, 39, 0.76)', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 3 },
  palmMarkerText: { color: '#FFF5D8', fontSize: 9, fontWeight: '800' },
  resultHero: { marginTop: 23, height: 277, overflow: 'hidden', borderRadius: 25, backgroundColor: '#39285D' },
  resultPalmImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  resultPalmImageFallback: { ...StyleSheet.absoluteFill, backgroundColor: '#563B83' },
  resultImageShade: { ...StyleSheet.absoluteFill },
  resultHeroCopy: { position: 'absolute', left: 18, right: 18, bottom: 18 },
  completeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: 'rgba(13, 34, 38, .75)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20 },
  completeBadgeText: { color: '#C7F6E8', fontSize: 10, fontWeight: '800' },
  resultGreeting: { color: '#DED8F3', fontSize: 13, marginTop: 12, fontWeight: '600' },
  resultTitle: { color: colors.text, fontSize: 27, lineHeight: 33, fontWeight: '800', marginTop: 2, letterSpacing: -0.5 },
  overviewBlock: { paddingVertical: 27, paddingHorizontal: 3 },
  sectionKicker: { color: colors.lavender, fontSize: 10, fontWeight: '800', letterSpacing: 1.35 },
  overviewText: { marginTop: 10, color: colors.text, fontSize: 17, lineHeight: 26, fontWeight: '500' },
  insightCard: { flexDirection: 'row', gap: 13, padding: 16, borderRadius: 19, borderWidth: 1, borderColor: colors.stroke, marginBottom: 12, overflow: 'hidden' },
  insightIcon: { width: 41, height: 41, flexShrink: 0, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(183, 164, 255, 0.13)' },
  insightContent: { flex: 1 },
  insightLabel: { color: '#EEEAFE', fontSize: 14, fontWeight: '800' },
  insightText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  affirmationCard: { flexDirection: 'row', gap: 10, padding: 16, borderRadius: 19, marginTop: 6, borderWidth: 1, borderColor: 'rgba(238, 200, 241, 0.24)' },
  affirmationCopy: { flex: 1 },
  affirmationLabel: { color: '#F3D9EF', fontSize: 10, fontWeight: '800', letterSpacing: 1.15 },
  affirmationText: { color: colors.text, fontSize: 13, lineHeight: 20, marginTop: 5, fontWeight: '600' },
  reportTwoColumn: { flexDirection: 'row', gap: 9, marginTop: 11 },
  reportSmallCard: { flex: 1, minHeight: 134, padding: 12, borderRadius: 16, backgroundColor: 'rgba(29, 20, 74, 0.89)', borderWidth: 1, borderColor: 'rgba(226, 180, 255, 0.27)' },
  reportCardKicker: { color: '#EBCB7D', fontSize: 8, letterSpacing: 0.8, fontWeight: '800' },
  reportProfileTitle: { color: '#F9F3FF', fontSize: 13, fontWeight: '800', marginTop: 8, lineHeight: 17 },
  reportProfileText: { color: '#CFC5E7', fontSize: 10, lineHeight: 15, marginTop: 8 },
  reportEye: { marginTop: 8 },
  reportScoreCard: { marginTop: 11, padding: 13, borderRadius: 17, backgroundColor: 'rgba(31, 21, 78, 0.91)', borderWidth: 1, borderColor: 'rgba(226, 180, 255, 0.3)' },
  reportSectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  reportSectionTitle: { color: '#FAF4FF', fontWeight: '800', fontSize: 13 },
  reportScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7 },
  reportScoreLabel: { color: '#D8D1E7', fontSize: 10, fontWeight: '700', width: 47 },
  reportScoreTrack: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: 8, overflow: 'hidden' },
  reportScoreFill: { height: '100%', borderRadius: 8 },
  reportScoreValue: { width: 29, textAlign: 'right', fontSize: 10, fontWeight: '800' },
  reportScoreNote: { color: '#AEA1CC', fontSize: 9, lineHeight: 13, marginTop: 10 },
  reportDetailsHeading: { color: '#FFE4A0', fontSize: 17, fontWeight: '800', marginTop: 19, marginBottom: 9, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) },
  reportInsightCard: { flexDirection: 'row', gap: 11, padding: 13, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(220, 174, 251, 0.26)', marginBottom: 9, overflow: 'hidden' },
  reportQuoteCard: { flexDirection: 'row', gap: 10, padding: 15, borderRadius: 16, marginTop: 4, borderWidth: 1, borderColor: 'rgba(249, 209, 110, 0.35)' },
  reportQuote: { flex: 1, color: '#FFF0C5', fontSize: 13, lineHeight: 19, fontWeight: '700', fontStyle: 'italic' },
  reportFooter: { color: '#A69ABC', fontSize: 8, letterSpacing: 0.7, fontWeight: '700', textAlign: 'center', marginTop: 18, marginBottom: 1 },
  reportSaveStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 15, paddingHorizontal: 9 },
  reportSaveStatusText: { color: '#C8C0DB', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  reportSaveError: { color: '#FFB5B5', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 8, paddingHorizontal: 8 },
  saveReportButton: { marginTop: 13, borderRadius: 15, overflow: 'hidden', shadowColor: '#F8CA65', shadowOpacity: 0.28, shadowRadius: 13, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  saveReportText: { color: colors.ink },
  footnote: { color: '#AAA3C0', textAlign: 'center', fontSize: 11, lineHeight: 17, marginTop: 15, paddingHorizontal: 18 },
});

export default App;
