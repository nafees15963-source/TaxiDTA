import type {CloudRepository} from './cloud-store.js';

export interface D1Database {
  prepare(query:string): {
    bind(...values:unknown[]): {
      first<T>():Promise<T|null>;
      run():Promise<{success:boolean;meta?:{changes?:number}}>;
    };
  };
}

/** Scope is the authenticated Sites user ID, never a browser-selected owner. */
export class D1CloudRepository implements CloudRepository {
  constructor(private readonly db:D1Database){}
  async read(scope:string){
    return await this.db.prepare('SELECT revision,payload FROM workspace_state WHERE scope=?').bind(scope).first<{revision:number;payload:string}>();
  }
  async compareAndSwap(scope:string,expectedRevision:number|null,payload:string){
    const query=expectedRevision===null
      ?this.db.prepare('INSERT INTO workspace_state(scope,revision,payload) VALUES(?,1,?) ON CONFLICT(scope) DO NOTHING').bind(scope,payload)
      :this.db.prepare('UPDATE workspace_state SET revision=revision+1,payload=? WHERE scope=? AND revision=?').bind(payload,scope,expectedRevision);
    const result=await query.run();
    if(!result.success)throw new Error('Persistent storage rejected the operation.');
    return result.meta?.changes===1;
  }
}
