import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

// Option 1 (Native SFSpeechRecognizer on iOS / SpeechRecognizer on Android)
let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: any = () => {};
let isSpeechRecognitionAvailable = false;

try {
  // Safely check if the native module can be loaded (prevent crash in Expo Go)
  const { requireNativeModule } = require('expo');
  if (requireNativeModule('ExpoSpeechRecognition')) {
    const speechModule = require('expo-speech-recognition');
    ExpoSpeechRecognitionModule = speechModule.ExpoSpeechRecognitionModule;
    useSpeechRecognitionEvent = speechModule.useSpeechRecognitionEvent;
    isSpeechRecognitionAvailable = true;
  }
} catch (e) {
  // Silent fallback for Expo Go
  console.log('Native Speech Recognition is not available (Expo Go fallback).');
}

// Master configuration toggle: set to false to use Option 2 (Record + Edge Function) now
export const USE_NATIVE_SPEECH_RECOGNITION = false;

// Option 2 state (Record using expo-av and transcribe using Supabase Edge Function with Whisper)
let recordingInstance: Audio.Recording | null = null;

export async function startAudioRecording(): Promise<boolean> {
  try {
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) return false;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    // Clean up any existing active recording instance just in case
    if (recordingInstance) {
      try {
        await recordingInstance.stopAndUnloadAsync();
      } catch (e) {}
      recordingInstance = null;
    }

    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    recordingInstance = recording;
    return true;
  } catch (err) {
    console.error('Error starting audio recording:', err);
    return false;
  }
}

export async function stopAudioRecordingAndTranscribe(): Promise<string | null> {
  if (!recordingInstance) return null;
  try {
    await recordingInstance.stopAndUnloadAsync();
    const uri = recordingInstance.getURI();
    recordingInstance = null;

    if (!uri) return null;

    // Convert recorded audio file to base64
    const base64Audio = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const fileExtension = uri.split('.').pop() || 'm4a';
    const mimeType = fileExtension === 'mp4' || fileExtension === 'm4a' ? 'audio/m4a' : `audio/${fileExtension}`;

    // Invoke our deployed Supabase Edge Function to transcribe using Whisper/Gemini
    const { data, error } = await supabase.functions.invoke('transcribe-audio', {
      body: { audioBase64: base64Audio, mimeType },
    });

    if (error) {
      console.error('Edge Function transcription error:', error);
      return null;
    }

    return data?.text || null;
  } catch (err) {
    console.error('Error stopping and transcribing recording:', err);
    return null;
  }
}

export {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  isSpeechRecognitionAvailable
};
