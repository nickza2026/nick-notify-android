import {authConfigRoute} from '@/lib/backend';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>authConfigRoute(request);
