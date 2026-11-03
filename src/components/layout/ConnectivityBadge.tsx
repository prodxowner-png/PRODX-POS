import React from 'react';
import { ConnectivityStatusIndicator, ConnectivityStatusIndicatorProps } from './ConnectivityStatusIndicator';

export type ConnectivityBadgeProps = ConnectivityStatusIndicatorProps;

export const ConnectivityBadge: React.FC<ConnectivityBadgeProps> = (props) => {
  return <ConnectivityStatusIndicator {...props} />;
};

export { ConnectivityStatusIndicator };
export default ConnectivityBadge;
