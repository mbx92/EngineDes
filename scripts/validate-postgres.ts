import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
// [MBX-5][SEQ-001][NFR-SEC-002] Validate real concurrency in a disposable local DB.
const maintenanceUrl=process.env.MIGRATION_DATABASE_URL,runtimeUrl=process.env.DATABASE_URL
if(!maintenanceUrl || !runtimeUrl)throw new Error('Local database credentials required')
const maintenance=new URL(maintenanceUrl),runtime=new URL(runtimeUrl)
if(!['localhost','127.0.0.1','[::1]'].includes(maintenance.hostname)||runtime.host!==maintenance.host)throw new Error('Local matching database hosts required')
const databaseName='enginedes_mbx5_'+randomBytes(6).toString('hex')+'_test'
maintenance.pathname='/postgres'
const sql=postgres(maintenance.toString(),{max:1})
try {
 await sql.unsafe('CREATE DATABASE "'+databaseName+'"')
 const testAdmin=new URL(maintenanceUrl);testAdmin.pathname='/'+databaseName;runtime.pathname='/'+databaseName
 console.log('Running isolated network PostgreSQL validation')
 const child=spawn('corepack',['pnpm','test'],{stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:testAdmin.toString(),TEST_RUNTIME_DATABASE_URL:runtime.toString()}})
 const code=await new Promise<number>((resolve,reject)=>{child.on('error',reject);child.on('exit',value=>resolve(value ?? 1))})
 process.exitCode=code
}finally {
 await sql.unsafe('DROP DATABASE IF EXISTS "'+databaseName+'" WITH (FORCE)')
 await sql.end()
 console.log('Disposable validation database removed')
}
