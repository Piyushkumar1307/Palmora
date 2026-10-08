export type ReadingSection = {
  id: string;
  label: string;
  insight: string;
};

export type PalmReading = {
  id: string;
  name: string;
  createdAt?: string;
  imageUrl?: string;
  imagePublicId?: string;
  reportImageUrl?: string;
  reportImagePublicId?: string;
  title: string;
  overview: string;
  sections: ReadingSection[];
  affirmation?: string;
  disclaimer?: string;
};

export type SelectedPalm = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  width?: number;
  height?: number;
};
