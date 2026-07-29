import mariadb, { type Pool } from 'mariadb';

import type { ServerConfig } from '../config.js';

export function createPool(config: ServerConfig): Pool {
  const databaseUrl = new URL(config.databaseUrl);

  return mariadb.createPool({
    host: databaseUrl.hostname,
    port: databaseUrl.port ? Number.parseInt(databaseUrl.port, 10) : 3306,
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: decodeURIComponent(databaseUrl.pathname.slice(1)),
    connectionLimit: config.dbPoolMax,
    timezone: 'Z',
    initSql: "SET time_zone = '+00:00'",
    bigIntAsNumber: false,
    insertIdAsNumber: false,
    decimalAsNumber: false,
    checkNumberRange: true,
    multipleStatements: false,
  });
}
