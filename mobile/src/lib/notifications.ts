import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Configure the default behavior for notifications when the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotificationsAsync(userId?: string | null) {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (true) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notifications!');
      return;
    }
    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      if (!projectId) {
        console.warn(
          '⚠️ EAS Project ID não encontrado. Por favor, inicialize seu projeto com "npx eas project:init" ou adicione "extra.eas.projectId" no app.json.'
        );
      }
      token = (await Notifications.getExpoPushTokenAsync({
        projectId,
      })).data;
      if (token) {
        await AsyncStorage.setItem('@classfy:push_token', token);
        if (userId) {
          await savePushTokenToSupabase(userId, token);
        }
      }
    } catch (e) {
      console.warn('Error getting Expo push token:', e);
    }
  }

  return token;
}

export async function savePushTokenToSupabase(userId: string, token: string) {
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ expo_push_token: token } as any)
      .eq('id', userId);
    
    if (error) {
      console.log('Push token not saved to profiles table:', error.message);
    } else {
      console.log('Push token successfully saved to profiles!');
    }
  } catch (e) {
    console.error('Error saving push token to database:', e);
  }
}
