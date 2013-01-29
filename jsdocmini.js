#!/usr/bin/env node
var opts = require('optimist');
var path = require('path');
var fs = require('fs');
var acorn = require('./lib/acorn.js');

var argv = opts.usage("Document a bunch of files.\nUsage $0")
               .demand(1)
               .default("out", "doc/")
               .describe("out", "where output should go").argv;


var outputDir = argv.out;
var inputFiles = argv._;

var filesNotReadYet = inputFiles.length;
var filesToWrite = 0;

inputFiles.forEach(documentFile);
var buffersToDocument = [];

function documentFile(path) {
  fs.readFile(path, function(err, b) {
    filesNotReadYet--;
    if (err) { throw err; }
    buffersToDocument.push({b: b, path: path});
  });
}

process.nextTick(eventLoop)

function eventLoop() {
  if (buffersToDocument.length != 0) {
    documentBuffer(buffersToDocument.shift());
  }
  if (filesNotReadYet != 0 || buffersToDocument.length != 0 || filesToWrite != 0) {
    process.nextTick(eventLoop);
  }
}


function documentBuffer(b) {
  var jsInput = b.b.toString('utf8');
  var comments = [];
  function checkComment(isBlock, text, start, end) {
    if (isBlock && text[0] == '*') {
      var startingStar = /^\s*\*/gim;
      var docSlug = getDocSlug(jsInput, end);
      var c = {text: text.replace(startingStar, ''), start: start};
      if (docSlug) {
        c.slug = docSlug
      }
      comments.push(c);
    }
  };
  try {
    acorn.parse(jsInput, {onComment: checkComment});
  } catch (ex) {
    console.error("Error parsing file " + b.path);
    console.error(ex);
  }
  comments.sort(function(a, b) { return a.start > b.start });
  ensureDir(comments, b.path);
}

function ensureDir(commentList, path) {
  filesToWrite++;
  fs.mkdir(outputDir, function(err, d) {
    outputDocs(commentList, path);
  });
}

function outputDocs(commentList, pathName) {
  var outParts = [];
  for (var i = 0; i < commentList.length; i++) {
    var c = commentList[i];
    var t = c.slug ? '## ' + c.slug + '\n' : '';
    t += c.text;
    outParts.push(t);
  }
  var fileName = path.basename(pathName, path.extname(pathName));
  fs.writeFile(outputDir + fileName + '.md',
    '# ' + fileName + '\n' +
    outParts.join('\n\n'),
    'utf8',
    function(err, f) {
      if (!err) console.log("Wrote docs for " + pathName);
      else console.error("Error writing docs for " + pathName);

      filesToWrite--;
    }
  );
}



function getDocSlug(jsStr, pos) {
  var rv = '';
  var len = jsStr.length;
  var oldPos = pos;
  while (!rv && pos < len) {
    var newPos = jsStr.indexOf('\n', pos + 1);
    rv = jsStr.substring(pos, newPos).trim();
    pos = newPos;
  }

  rv = rv.replace(/^.*\w+\.prototype\.(\w+).*$/g, '$1');
  return rv;
}


