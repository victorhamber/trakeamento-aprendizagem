"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
var dotenv_1 = require("dotenv");
var pg_mem_1 = require("pg-mem");
require('dotenv').config({ path: '../../.env' });
var pg_1 = require("pg");
var fs_1 = require("fs");
var path_1 = require("path");
var cwd = process.cwd();
var findEnvFile = function () {
    var candidates = [
        path_1.default.resolve(cwd, '.env'),
        path_1.default.resolve(cwd, '..', '.env'),
        path_1.default.resolve(cwd, '..', '..', '.env'),
        path_1.default.resolve(cwd, '..', '..', '..', '.env'),
    ];
    for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
        var p = candidates_1[_i];
        if (fs_1.default.existsSync(p))
            return p;
    }
    return null;
};
if (process.env.NODE_ENV !== 'production') {
    var envPath = findEnvFile();
    if (envPath)
        dotenv_1.default.config({ path: envPath });
    else
        dotenv_1.default.config();
}
var databaseUrl = process.env.DATABASE_URL;
console.log('--- DB CONNECTION DEBUG ---');
if (databaseUrl) {
    console.log('Using REAL Database (PostgreSQL)');
    // Mask password in logs
    console.log('Connection String:', databaseUrl.replace(/:([^:@]+)@/, ':***@'));
}
else {
    console.log('WARNING: DATABASE_URL not found! Using IN-MEMORY (pg-mem) database.');
    console.log('Data will be LOST on restart.');
}
console.log('---------------------------');
exports.pool = databaseUrl
    ? new pg_1.Pool({
        connectionString: databaseUrl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    })
    : (function () {
        var db = (0, pg_mem_1.newDb)();
        var adapter = db.adapters.createPg();
        return new adapter.Pool();
    })();
