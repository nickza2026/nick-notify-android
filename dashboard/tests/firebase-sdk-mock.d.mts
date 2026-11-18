export const state: {
  apps:Array<{name:string;options:Record<string,unknown>}>;
  signouts:number;
  popupError:unknown;
  uid:string;
  verified:boolean;
  token:string;
  persistence:unknown;
  parameters?:Record<string,string>;
};
