export type Character = {
  id: string;
  name: string;
  appearance: string;
};

export type Beat = {
  order: number;
  purpose: string;
  plot: string;
  emotion: string;
  characters: string[];
};

export type Script = {
  logline: string;
  characters: Character[];
  motif: string;
  styleBible: string;
  settingBible: string;
  beats: Beat[];
};
