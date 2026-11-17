// web/src/services/sendPushNotification.ts
import { firestore } from '../firebase';
import {
  collection,
  query,
  where,
  getDocs,
  limit,
} from 'firebase/firestore';

export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data: Record<string, any> = {}
): Promise<void> {
  try {
    const tokenSnap = await getDocs(
      query(
        collection(firestore, 'user_push_tokens'),
        where('userId', '==', userId),
        limit(1)
      )
    );

    if (tokenSnap.empty) {
      console.warn('⚠️ No push token for user:', userId);
      return;
    }

    const token = tokenSnap.docs[0].data()?.token?.toString();
    if (!token) return;

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        sound: 'default',
        title,
        body,
        data,
        priority: 'high',
        channelId: 'default',
      }),
    });

    const result = await response.json();
    console.log('📤 Push sent:', result);
  } catch (e) {
    console.warn('sendPushToUser error:', e);
  }
}