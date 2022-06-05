const express = require('express');
const app = express();
const port = 3010;
const bodyparser = require('body-parser')
const fs = require('fs');

app.use(express.static('static'));
app.use( bodyparser.urlencoded({ extended: true }));

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('data.db',sqlite3.OPEN_READWRITE, (err)=>{
    if (err) throw err;
})

function init() {
    db.serialize(()=>{
        db.run('create table if not exists userPass (userId integer primary key autoincrement, user varchar(30) not null unique, pass varchar(20) not null)',(err)=>{
            if (err) throw err;
        })
        db.run('create table if not exists sessions (userId integer, user varchar(30), session varchar)',(err)=>{
            if (err) throw err;
        })
        db.run('create table if not exists accData (userId integer)',(err)=>{
            if (err) throw err;
        })
    })
}

init();

function reset(tableName) {
    db.run(`delete from ${tableName}`,(err)=>{
        if (err) throw err;
    });
}

function createAcc(user,pass,res) {
    db.serialize(()=>{
        db.get('select count(*) from userPass where user=?',[user],(err,row)=>{
            if (err) throw err;
            if (row['count(*)']<1) {
                db.run('insert into userPass (user, pass) values(?,?)',[user,pass],(err)=>{
                    if (err) throw err;
                    logGreen('done');
                    res.send({status:'success'});
                })
            }
            else {
                logRed('username taken')
                res.send({status:'fail', reason:'username taken'});
            }
        })
    })
}

function login(user,pass,res) {
    db.serialize(()=>{
        let result = {};
        db.get('select count(*) from userPass where user=? and pass=?',[user,pass],(err,row)=>{
            if (err) throw err;
            if (row['count(*)']>0) {
                let session = Date.now().toString()+'-'+Math.round(Math.random()*1000000).toString();
                db.serialize(()=>{
                    db.run('delete from sessions where user=(select user from userPass where user=?)',[user],(err)=>{
                        if (err) throw err;
                    })
                    db.run('insert into sessions values((select userId from userPass where user=?), ?, ?)',[user,user,session],(err)=>{
                        if (err) throw err;
                        logGreen(`success. session: ${session}`)
                        res.send({status:'success', session:session});
                    })
                })
            }
            else {
                logRed('not found')
                res.send({status:'failed',reason:'wrong user or pass'});
            }
        })
    })
}

function loginSession(session,res) {
    console.log(session);
    db.get('select user from sessions where session=?',[session],(err,row)=>{
        if (err) throw err;
        logGreen('found user: ' + row.user);
        res.send({status:'success'});
    })
}

function genDataTable(...columns) {
    Array.from(columns).forEach(x=>{
        db.run(`alter table accData add column ${x} varchar`,(err)=>{
            if (err) throw err;
        })
    })
}

function checkCD(session,res,x,y,color) {
    db.get('select count(timeSince) from accData where userId=(select userId from sessions where session=?)',[session],(err,row)=>{
        if (err) throw err;
        if (row['count(timeSince)']>0) {
            db.get('select timeSince from accData where userId=(select userId from sessions where session=?)',[session],(err,row)=>{
                console.log(row.timeSince);
                console.log(Date.now()-row.timeSince);
                if (err) throw err;
                if ((Date.now() - parseInt(row.timeSince))>20000) {
                    console.log('not in cooldown')
                    grid[y][x] = color;
                    db.run('update accData set timeSince=? where userId=(select userId from sessions where session=?)',[Date.now(),session],(err)=>{
                        if (err) throw err;
                        res.send([{status:'success'},grid]);
                    })
                }
                else {
                    console.log('in cooldown');
                    db.get('select timeSince from accData where userId=(select userId from sessions where session=?)',[session],(err,row)=>{
                        console.log(row);
                        res.send([{status:'failed'},grid,row.timeSince]);
                    })
                }
            })
        }
        else {
            db.get('insert into accData values((select userId from sessions where session=?),?)',[session,Date.now()],(err)=>{
                if (err) throw err;
                grid[y][x] = color;
                res.send([{status:'success'},grid]);
            })
        }
    })
}

function saveData(session,data) {
    db.run('delete from accData where userId=(select userId from sessions where session=?)',[session],(err)=>{
        if (err) throw err;
    })
    db.get('select userId from userPass where user=(select user from sessions where session=?)',[session],(err,row)=>{
        if (err) throw err;
        let datum = `(?,`
        let insertVals = [];
        for (x in data) {
            datum+='?,';
            insertVals.push(data[x]);
        }
        logRed(insertVals);
        datum = datum.substring(0,datum.length-1);
        datum += ')'
        insertVals.unshift(row.userId);
        db.run(`insert into accData values${datum}`,insertVals,(err)=>{
            if (err) throw err;
            logGreen('saved');
        })
    })  
}

function getData(session,cat) {
    let result = [];
    db.get('select userId from userPass where user=(select user from sessions where session=?)',[session],(err,row)=>{
        if (err) throw err;
        db.all(`select ${cat} from accData where userId=?`,[row.userId],(err,row)=>{
            if (err) throw err;
            row.forEach(x=>{
                console.log(x[cat]);
            })
        })
    })
}

function logGreen(txt) {
    console.log('\u001b[' + 32 + 'm' + txt + '\u001b[0m')
}

function logRed(txt) {
    console.log('\u001b[' + 31 + 'm' + txt + '\u001b[0m')
}

app.post('/login',(req,res)=>{
    let user = req.body.user;
    let pass = req.body.pass;
    console.log(`/login user: ${user}, pass: ${pass}`);
    login(user,pass,res);
})

app.post('/create',(req,res)=>{
    let user = req.body.user;
    let pass = req.body.pass;
    console.log(`/create user: ${user} pass: ${pass}`);
    createAcc(user,pass,res);
})

app.post('/loginSession',(req,res)=>{
    let session = req.body.session;
    loginSession(session,res);
})

app.post('/turnBlock',(req,res)=>{
    let x = req.body.x;
    let y = req.body.y;
    let color = req.body.color;
    let session = req.body.session;
    checkCD(session,res,x,y,color);
})

app.get('/getGrid',(req,res)=>{
    res.send(grid);
})

app.listen(port,()=>{
    console.log('listening at port ' + port);
})

let grid = [];
for (let y=0; y<50; y++) {
    grid.push([]);
    for (let x=0; x<50; x++) {
        grid[y].push('white');
    }
}

let result = fs.readFileSync('worldBackUp.txt','utf-8')
if (result != '') {
    // console.log(result.split(','));
    grid = JSON.parse(result);
}

fs.writeFileSync('worldBackUp.txt',JSON.stringify(grid));
setInterval(()=>{
    fs.writeFileSync('worldBackUp.txt',JSON.stringify(grid));
},10000);
