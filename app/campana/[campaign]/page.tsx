import { currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Workspace from './workspace';
export const dynamic = 'force-dynamic';
export default async function Campaign({ params }: { params: Promise<{ campaign: string }> }) {
  if (!(await currentUser())) redirect('/login');
  return <Workspace campaignId={(await params).campaign} />;
}
