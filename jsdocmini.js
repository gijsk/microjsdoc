#!/usr/bin/env node
var opts = require('optimist');
var path = require('path');
var fs = require('fs');
var acorn = require('./lib/acorn.js');
var sd = require('showdown');
var showdown = new sd.converter();

var argv = opts.usage("Document a bunch of files.\nUsage $0")
               .demand(1)
               .describe("pre", "pre-processing JS file.")
               .describe("post", "post-processing JS file.")
               .describe("css", "CSS file to include")
               .default("out", "doc/")
               .describe("out", "where output should go").argv;


var outputDir = argv.out;
if (outputDir.charAt(outputDir.length - 1) != path.sep) {
  outputDir += path.sep;
}
var preProcess = argv.pre ? require(argv.pre) : function(x) { return x; };
var postProcess = argv.post ? require(argv.post) : function(x) { return x; };
var cssFile = argv.css || '';
var inputFiles = argv._;
var pendingDirExplorations = 0;
var pendingReads = 0;
var buffersToDocument = [];
var filesToWrite = 0;

var totalFilesParsed = 0, totalFilesWritten = 0;
function copyFile(src, target, cb) {
  var readStream = fs.createReadStream(src),
      writeStream = fs.createWriteStream(target);
  readStream.pipe(writeStream);
  readStream.once('end', cb);
}


function handleCSS(cb) {
  if (cssFile) {
    fs.mkdir(outputDir, function(err, d) {
      copyFile(cssFile, outputDir + 'style.css', function(err) {
        cb();
        console.log("Copied CSS file");
      });
    });
  } else {
    process.nextTick(cb);
  }
}

function documentFile(pathName) {
  pendingReads++;
  totalFilesParsed++;
  fs.readFile(pathName, function(err, b) {
    pendingReads--;
    if (err) {
      if (err.code == 'EISDIR') {
        pendingDirExplorations++;
        console.log(pathName + " is a directory, reading all files...");
        fs.readdir(pathName, function onFiles(err, files) {
          if (err) throw err;
          files.forEach(function(f) {
            if (path.extname(f) == '.js') {
              inputFiles.push(pathName + path.sep + f);
            }
          });
          pendingDirExplorations--;
        });
      } else {
        throw err;
      }
    } else {
      buffersToDocument.push({b: b, path: pathName});
    }
  });
}

process.nextTick(eventLoop)

function eventLoop() {
  var pendingStuff = pendingReads + pendingDirExplorations + inputFiles.length + buffersToDocument.length + filesToWrite;
  if (pendingStuff != 0) {
    process.nextTick(eventLoop);
  } else {
    function finish() {
      console.log("Finished, wrote documentation for " + totalFilesWritten + " out of " + totalFilesParsed + " files.");
    }
    handleCSS(finish);
  }

  if (inputFiles.length != 0) {
    documentFile(inputFiles.shift());
  }
  if (buffersToDocument.length != 0) {
    documentBuffer(buffersToDocument.shift());
  }
}


function documentBuffer(b) {
  var jsInput = b.b.toString('utf8');
  var comments = [];
  function checkComment(isBlock, text, start, end) {
    if (isBlock && text[0] == '*') {
      var startingStar = /^\s*\*\s?/gim;
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

function ensureDir(commentList, pathName) {
  if (commentList.length) {
    filesToWrite += 2;
    fs.mkdir(outputDir, function(err, d) {
      outputDocs(commentList, pathName);
    });
  }
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
  var md = '# ' + fileName + '\n' + outParts.join('\n\n');
  md = preProcess(md);
  var wrote = false;
  function onFW(err) {
    if (err) {
      console.error("Error writing docs for " + fileName);
    }
    if (wrote) {
      console.log("Finished writing docs for " + fileName);
    } else if (!err) {
      totalFilesWritten++;
      wrote = true;
    }
    filesToWrite--;
  }
  fs.writeFile(outputDir + fileName + '.md', md, 'utf8', onFW);

  var html = '<!DOCTYPE html><html><head><title>' + fileName + '</title><meta charset="utf8">';
  if (cssFile) {
    html += '<link href="style.css" rel="stylesheet" type="text/css" />';
  }
  html += postProcess(showdown.makeHtml(md));
  fs.writeFile(outputDir + fileName + '.html', html, 'utf8', onFW);
}



function getDocSlug(jsStr, pos) {
  var rv = '';
  var len = jsStr.length;
  var oldPos = pos;
  while (!rv && pos < len) {
    var newPos = jsStr.indexOf('\n', pos + 1);
    rv = jsStr.substring(pos, newPos);
    pos = newPos;
  }

  var replacers = [
    /function\s+(\w+)\(.*$/g,
    /(?:^|\W+)(\w+)\s*[:=]\s*function\s*\(.*$/g,
    /\w+\.prototype\.(\w+).*$/g
  ];

  var haveReplaced = false, i = replacers.length, lastRV = rv;
  while (i-- > 0 && !haveReplaced) {
    lastRV = rv;
    rv = rv.replace(replacers[i], '$1');
    haveReplaced = (rv != lastRV);
  }
  return haveReplaced ? rv.trim() : '';
}


