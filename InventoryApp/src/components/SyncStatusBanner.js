import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Colors from '../theme/colors';

export default function SyncStatusBanner({ online, lastSync, pendingCount }) {
  const isOnline = online === true;
  return (
    <View style={[styles.banner, { backgroundColor: isOnline ? Colors.success : Colors.error }]}>
      <MaterialCommunityIcons
        name={isOnline ? 'cloud-check' : 'cloud-off-outline'}
        size={16}
        color="#fff"
      />
      <Text style={styles.text}>
        {isOnline ? ' Online' : ' Offline'}
        {isOnline && lastSync ? `  •  Last sync: ${new Date(lastSync).toLocaleTimeString()}` : ''}
        {pendingCount > 0 ? `  •  ${pendingCount} pending` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
