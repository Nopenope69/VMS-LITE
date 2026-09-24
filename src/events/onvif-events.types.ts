export const ONVIF_TOPIC_CELL_MOTION = 'tns1:RuleEngine/CellMotionDetector/Motion';
export const ONVIF_TOPIC_VIDEO_SOURCE_MOTION = 'tns1:VideoSource/MotionAlarm';
export const ONVIF_TOPIC_TAMPER = 'tns1:RuleEngine/TamperDetector/Tamper';

export interface OnvifEventSubscription {
  cameraId: string;
  cameraName: string;
  xaddr: string;
  username?: string;
  password?: string;
  subscriptionUrl: string | null;
  terminationTime: Date | null;
  active: boolean;
  errorCount: number;
  lastPoll: Date | null;
}

export interface ParsedOnvifEvent {
  topic: string;
  isMotion: boolean;
  isTamper: boolean;
  timestamp: Date;
  data: Record<string, any>;
}

export interface OnvifPullMessagesOptions {
  timeoutSeconds?: number;
  messageLimit?: number;
}
