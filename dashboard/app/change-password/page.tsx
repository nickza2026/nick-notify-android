import { requirePageSession } from '@/lib/page-auth';
import AuthForm from '../auth-form';
export const dynamic='force-dynamic';
export default async function ChangePassword(){await requirePageSession(true);return <AuthForm change/>;}
