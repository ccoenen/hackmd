var fs = require('fs');
var process = require('process');
var child_process = require('child_process');
var Promise = require('bluebird');
var NodeGit = require('nodegit');
var models = require("../lib/models");
var config = require('../config.json').dumpToGit;

var repoRootDir = config.targetDirectory;

try {
  process.chdir(repoRootDir);
} catch (e) {
  console.error("The target directory for your notes does not exist, please create %s", repoRootDir);
  process.exit(1);
}


function exportNotes() {
  return models.Note
  .findAll()
  .then(function (notes) {
    // Iterate over all notes
    return Promise.all(notes.map(function (note) {
      if (note.content.length < 1) {
        console.log('Skipping empty note ' + note.id);
        return Promise.resolve();
      }
      var fileName = note.title + " - " + note.id + ".md";
      fileName = fileName.replace('/', '_');


      // Export note to file
      return new Promise(function (resolve) {
        console.log('Exporting ' + note.id + ' to ' + fileName);
        fs.writeFile(fileName, note.content, resolve);
      })
      .then(function () {
        return fileName;
      });

    }));
  });
}


function addToIndexAndReturnTree(files, index) {
  return Promise.all(files.map(function (file) {
    console.log('Adding ' + file + ' to git index');
    return index.addByPath(file);
  }))
  .then(function () {
    console.log('Write files to git index');
    return index.write();
  })
  .then(function () {
    console.log('Write git index to tree');
    return index.writeTree();
  });
}


function getHeadCommit(repo) {
  return NodeGit.Reference
  .nameToId(repo, 'HEAD')
  .then(function (headRef) {
    return repo.getCommit(headRef);
  });
}


function commit(repo, tree) {
  return getHeadCommit(repo)
  .then(function (head) {
    console.log('Commiting...');
    var sig = NodeGit.Signature.now(config.name, config.email);
    return repo.createCommit('HEAD', sig, sig, 'Automated import', tree, [head]);
  });
}


NodeGit.Repository
.open('.')
.then(function (repo) {

  return exportNotes()
  .then(function(files) {

    files = files.filter(function (value) {return !!value;});

    return getHeadCommit(repo)
    .then(function (head) {
      return head.getTree();
    })
    .then(function (tree) {
      console.log('Diff HEAD to workdir');
      var opts = new NodeGit.DiffOptions();
      opts.flags |= NodeGit.Diff.OPTION.INCLUDE_UNTRACKED;
      return NodeGit.Diff.treeToWorkdir(repo, tree, opts);
    })
    .then(function (diff) {
      console.log('Number of deltas: ' + diff.numDeltas());
      if (diff.numDeltas() == 0) {
        console.log('Nothing to commit');
        return;
      }

      return repo.refreshIndex()
      .then(function (index) {
        return addToIndexAndReturnTree(files, index);
      })
      .then(function (tree) {
        return commit(repo, tree);
      });
    })
    .then(function () {
      console.log('Get remote...');
      return repo.getRemote('origin')
    })
    .then(function (remote) {
      console.log('Push to origin');
      // Didn't get remote.push() to work...
      child_process.exec('git push');
      // return remote.push(
      //   ['refs/heads/master:refs/heads/master'],
      //   {
      //     callbacks: {
      //       credentials: function(url, userName) {
      //         console.log('credential for ' + url + ' and ' + userName);
      //         return nodegit.Cred.sshKeyFromAgent(userName);
      //       }
      //     }
      //   }
      // );
    });
  });
})
.catch(function (error) {
  console.log(error.message);
});
