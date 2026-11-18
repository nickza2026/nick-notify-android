import {googleSetupConfigRoute} from '@/lib/backend';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>googleSetupConfigRoute(request);
