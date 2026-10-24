// The driver's test entry point: runs the steps of the current session with
// Mocha and fails when any step failed. The steps record their own outcomes.
'use strict';

const path = require('path');
const Mocha = require('mocha');

function run() {
  const mocha = new Mocha({ ui: 'tdd', timeout: 0, color: false });
  mocha.addFile(path.join(__dirname, 'steps.js'));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} clean-install step(s) failed`));
      } else {
        resolve();
      }
    });
  });
}

module.exports = { run };
