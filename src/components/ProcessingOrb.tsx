import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme';

export function ProcessingOrb() {
  const spin = useRef(new Animated.Value(0)).current;
  const reverseSpin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0.86)).current;
  const scan = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 6200, useNativeDriver: true }),
    );
    const reverseLoop = Animated.loop(
      Animated.timing(reverseSpin, { toValue: 1, duration: 8800, useNativeDriver: true }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.86, duration: 1200, useNativeDriver: true }),
      ]),
    );
    const scanLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, { toValue: 1, duration: 1650, useNativeDriver: true }),
        Animated.timing(scan, { toValue: 0, duration: 1650, useNativeDriver: true }),
      ]),
    );

    spinLoop.start();
    reverseLoop.start();
    pulseLoop.start();
    scanLoop.start();

    return () => {
      spinLoop.stop();
      reverseLoop.stop();
      pulseLoop.stop();
      scanLoop.stop();
    };
  }, [pulse, reverseSpin, scan, spin]);

  const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const reverseRotation = reverseSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });
  const scanY = scan.interpolate({ inputRange: [0, 1], outputRange: [-46, 46] });

  return (
    <View style={styles.wrap} accessibilityLabel="Palm analysis in progress">
      <Animated.View style={[styles.outerOrbit, { transform: [{ rotate: rotation }] }]}>
        <View style={[styles.dot, styles.dotOne]} />
        <View style={[styles.dot, styles.dotTwo]} />
      </Animated.View>
      <Animated.View style={[styles.middleOrbit, { transform: [{ rotate: reverseRotation }] }]}>
        <View style={styles.smallDot} />
      </Animated.View>
      <Animated.View style={[styles.coreWrap, { transform: [{ scale: pulse }] }]}>
        <LinearGradient colors={['#E9C3F5', '#AA8BFF', '#7054DB']} style={styles.core}>
          <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanY }] }]} />
          <Ionicons name="hand-left-outline" color={colors.text} size={46} />
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 232,
    height: 232,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerOrbit: {
    position: 'absolute',
    width: 218,
    height: 218,
    borderRadius: 109,
    borderWidth: 1,
    borderColor: 'rgba(218, 196, 255, 0.32)',
  },
  middleOrbit: {
    position: 'absolute',
    width: 174,
    height: 174,
    borderRadius: 87,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  dot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.mint,
    shadowColor: colors.mint,
    shadowOpacity: 0.9,
    shadowRadius: 10,
  },
  dotOne: { top: -5, left: 73 },
  dotTwo: { bottom: 11, right: 19, backgroundColor: '#F4B3E4' },
  smallDot: {
    position: 'absolute',
    right: 16,
    top: 11,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#F5D69D',
  },
  coreWrap: {
    width: 128,
    height: 128,
    borderRadius: 64,
    shadowColor: '#BFA8FF',
    shadowOpacity: 0.7,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  core: {
    flex: 1,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  scanLine: {
    position: 'absolute',
    left: 17,
    right: 17,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    opacity: 0.85,
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
});
