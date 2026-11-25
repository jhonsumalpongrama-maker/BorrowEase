import express from 'express';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
mkdirSync(path.join(root,'data'),{recursive:true});
const db=new DatabaseSync(path.join(root,'data','borrowease.db'));
db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), description TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS loans(id INTEGER PRIMARY KEY,item_id INTEGER NOT NULL REFERENCES items(id), borrower TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), borrowed_date TEXT NOT NULL,due_date TEXT NOT NULL,returned_date TEXT);`);
const app=express(); app.use(express.json());
const items=()=>db.prepare(`SELECT i.*,i.quantity-COALESCE((SELECT SUM(l.quantity) FROM loans l WHERE l.item_id=i.id AND l.returned_date IS NULL),0) AS available FROM items i ORDER BY i.name`).all();
const loans=()=>db.prepare(`SELECT l.*,i.name AS item_name FROM loans l JOIN items i ON i.id=l.item_id ORDER BY l.id DESC`).all();
const fail=(res,msg,status=400)=>res.status(status).json({error:msg});
const str=v=>typeof v==='string'?v.trim():'';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
app.get('/api/items',(req,res)=>res.json(items()));
app.get('/api/loans',(req,res)=>res.json(loans()));
function saveItem(req,res,edit=false){const {name,category,quantity,description}=req.body;const n=Number(quantity);if(!str(name)||!str(category)||!Number.isSafeInteger(n)||n<1)return fail(res,'Enter a name, category and positive whole quantity.');if(edit){const old=items().find(i=>i.id===Number(req.params.id));if(!old)return fail(res,'Item not found.',404);if(n<old.quantity-old.available)return fail(res,'Quantity cannot be below the number currently borrowed.');db.prepare('UPDATE items SET name=?,category=?,quantity=?,description=? WHERE id=?').run(str(name),str(category),n,str(description),old.id);}else db.prepare('INSERT INTO items(name,category,quantity,description) VALUES(?,?,?,?)').run(str(name),str(category),n,str(description));res.status(edit?200:201).json({ok:true});}
app.post('/api/items',(q,s)=>saveItem(q,s));app.put('/api/items/:id',(q,s)=>saveItem(q,s,true));
app.delete('/api/items/:id',(req,res)=>{const id=Number(req.params.id);if(!items().some(i=>i.id===id))return fail(res,'Item not found.',404);if(db.prepare('SELECT 1 FROM loans WHERE item_id=?').get(id))return fail(res,'This item has borrowing history and cannot be deleted.');db.prepare('DELETE FROM items WHERE id=?').run(id);res.json({ok:true});});
app.post('/api/loans',(req,res)=>{const {item_id,borrower,quantity,borrowed_date,due_date}=req.body;const item=items().find(i=>i.id===Number(item_id));const n=Number(quantity);if(!item||!str(borrower)||!Number.isSafeInteger(n)||n<1)return fail(res,'Select an item, enter borrower name and a valid quantity.');if(n>item.available)return fail(res,'Not enough available stock.');if(!validDate(borrowed_date)||!validDate(due_date)||borrowed_date>today()||due_date<borrowed_date)return fail(res,'Use valid dates; due date must not precede borrowing date and borrowing cannot be in the future.');db.prepare('INSERT INTO loans(item_id,borrower,quantity,borrowed_date,due_date) VALUES(?,?,?,?,?)').run(item.id,str(borrower),n,borrowed_date,due_date);res.status(201).json({ok:true});});
app.patch('/api/loans/:id/return',(req,res)=>{const row=db.prepare('SELECT * FROM loans WHERE id=?').get(Number(req.params.id));if(!row)return fail(res,'Transaction not found.',404);if(row.returned_date)return fail(res,'Already returned.');db.prepare('UPDATE loans SET returned_date=? WHERE id=?').run(today(),row.id);res.json({ok:true});});
app.use('/api',(req,res)=>fail(res,'API route not found.',404));
if(existsSync(path.join(root,'dist','index.html'))){app.use(express.static(path.join(root,'dist')));app.get(/.*/,(req,res)=>res.sendFile(path.join(root,'dist','index.html')));}
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Unexpected server error.'});});
app.listen(Number(process.env.PORT)||4000,()=>console.log('BorrowEase API running on port '+(process.env.PORT||4000)));
