import type { StudioProject } from '../../../../shared/studio';

export type StudioPromotionSource = {
  projectId: string;
  revision: number;
  range?: { start: number; end: number };
  snapshot?: StudioProject;
};
type Invitation = StudioPromotionSource & { submissionId: string };

const invitationKey = (owner: string) => `classfy:studio:promotion:${owner}`;

export function promotionInvitations(owner: string): Invitation[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(invitationKey(owner)) ?? '[]');
    return Array.isArray(entries) ? entries.filter(entry => entry &&
      typeof entry.submissionId === 'string' && typeof entry.projectId === 'string' && Number.isSafeInteger(entry.revision)) : [];
  }
  catch { return []; }
}

export function changePromotionInvitation(owner: string, submissionId: string, project?: Omit<Invitation, 'submissionId'>) {
  try {
    const invitations = promotionInvitations(owner).filter(entry => entry.submissionId !== submissionId);
    if (project) invitations.push({ ...project, submissionId });
    try { localStorage.setItem(invitationKey(owner), JSON.stringify(invitations)); }
    catch {
      if (!project?.snapshot) return;
      invitations[invitations.length - 1] = { ...project, submissionId, snapshot: undefined };
      localStorage.setItem(invitationKey(owner), JSON.stringify(invitations));
    }
  } catch { /* Local storage is optional for publication. */ }
}
