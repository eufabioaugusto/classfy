import QRCode from 'qrcode';

export const REFERRAL_ARTWORKS = [
  { id: 'feed', title: 'Uma nova descoberta', format: 'Feed · 4:5', width: 1080, height: 1350, source: '/referrals/invite-feed.png', qr: { x: 852, y: 1142, size: 132 }, url: { x: 94, y: 1252, maxWidth: 726 } },
  { id: 'story', title: 'Compartilhe uma descoberta', format: 'Story · 9:16', width: 1080, height: 1920, source: '/referrals/invite-story.png', qr: { x: 816, y: 1512, size: 168 }, url: { x: 94, y: 1640, maxWidth: 690 } },
] as const;
export type ReferralArtwork = typeof REFERRAL_ARTWORKS[number];

export async function createReferralArtwork(art: ReferralArtwork, referralUrl: string) {
  const url = new URL(referralUrl);
  if (url.origin !== 'https://classfy.com.br' || !url.searchParams.get('ref')) throw new Error('Invalid referral URL');
  const image = new Image();
  image.src = art.source;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = art.width; canvas.height = art.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(image, 0, 0, art.width, art.height);
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, referralUrl, { width: art.qr.size, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#16141b', light: '#ffffff' } });
  ctx.drawImage(qr, art.qr.x, art.qr.y);
  const displayUrl = referralUrl.replace('https://', '');
  let size = 24;
  ctx.font = `${size}px Arial, sans-serif`;
  while (ctx.measureText(displayUrl).width > art.url.maxWidth && size > 16) ctx.font = `${--size}px Arial, sans-serif`;
  ctx.fillStyle = '#706974';
  ctx.fillText(displayUrl, art.url.x, art.url.y);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Export failed')), 'image/png'));
  return URL.createObjectURL(blob);
}
