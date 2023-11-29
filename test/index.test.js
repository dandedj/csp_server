const assert = require('assert');
const myFunctions = require('../functions/index.js');

describe('Cloud Functions', () => {
  it('should have a function called helloWorld', () => {
    assert.equal(typeof myFunctions.helloWorld, 'function');
  });
});