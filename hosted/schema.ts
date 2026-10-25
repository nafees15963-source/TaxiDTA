import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';

/** Bounded synthetic workspace; a revision compare-and-swap commits one complete operation. */
export const workspaceState=sqliteTable('workspace_state',{
  scope:text('scope').primaryKey().notNull(),
  revision:integer('revision').notNull(),
  payload:text('payload').notNull(),
});
