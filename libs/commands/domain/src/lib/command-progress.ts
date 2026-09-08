export interface CommandProgress {
  current: number;
  total: number;
  currentItem?: string;
}

export interface CommandProgressReporter {
  report(progress: CommandProgress): Promise<void>;
}
