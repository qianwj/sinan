export type ActorRole = 'product_manager' | 'designer' | 'development_engineer' | 'qa_engineer' | 'devops_engineer';

export interface Actor {
  name: string;
  role: ActorRole;
  workspace: string;
  constructor(name: string, role: ActorRole, workspace: string): Actor;
}

// export class ActorImpl implements Actor {
// }
