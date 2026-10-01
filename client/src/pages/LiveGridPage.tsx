import React from 'react';
import { LiveViewPage, LiveViewPageProps } from './LiveViewPage.js';

export type LiveGridPageProps = LiveViewPageProps;

export const LiveGridPage: React.FC<LiveGridPageProps> = (props) => {
  return <LiveViewPage {...props} />;
};

export default LiveGridPage;
