export interface LidarrPlanAction {
  action: string;
  artistMbid?: string;
  artistName?: string;
  releaseGroupId?: string;
  albumTitle?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}
export interface LidarrPlan {
  actions: LidarrPlanAction[];
}
