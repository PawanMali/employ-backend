'use strict';

/*!
 * Module dependencies.
 */

const Mixed = require('../schema/mixed');
const ValidationError = require('../error/validation');
const flatten = require('./common').flatten;
const modifiedPaths = require('./common').modifiedPaths;
const parallel = require('async/parallel');

/**
 * Applies validators and defaults to update and findOneAndUpdate operations,
 * specifically passing a null doc as `this` to validators and defaults
 *
 * @param {Query} query
 * @param {Schema} schema
 * @param {Object} castedDoc
 * @param {Object} options
 * @method runValidatorsOnUpdate
 * @api private
 */

module.exports = function(query, schema, castedDoc, options) {
  let _keys;
  const keys = Object.keys(castedDoc || {});
  let updatedKeys = {};
  let updatedValues = {};
  const isPull = {};
  const arrayAtomicUpdates = {};
  const numKeys = keys.length;
  let hasDollarUpdate = false;
  const modified = {};
  let currentUpdate;
  let key;
  let i;

  for (i = 0; i < numKeys; ++i) {
    if (keys[i].charAt(0) === '$') {
      hasDollarUpdate = true;
      if (keys[i] === '$push' || keys[i] === '$addToSet') {
        _keys = Object.keys(castedDoc[keys[i]]);
        for (let ii = 0; ii < _keys.length; ++ii) {
          currentUpdate = castedDoc[keys[i]][_keys[ii]];
          if (currentUpdate && currentUpdate.$each) {
            arrayAtomicUpdates[_keys[ii]] = (arrayAtomicUpdates[_keys[ii]] || []).
              concat(currentUpdate.$each);
          } else {
            arrayAtomicUpdates[_keys[ii]] = (arrayAtomicUpdates[_keys[ii]] || []).
              concat([currentUpdate]);
          }
        }
        continue;
      }
      modifiedPaths(castedDoc[keys[i]], '', modified);
      const flat = flatten(castedDoc[keys[i]]);
      const paths = Object.keys(flat);
      const numPaths = paths.length;
      for (let j = 0; j < numPaths; ++j) {
        let updatedPath = paths[j].replace('.$.', '.0.');
        updatedPath = updatedPath.replace(/\.\$$/, '.0');
        key = keys[i];
        // With `$pull` we might flatten `$in`. Skip stuff nested under `$in`
        // for the rest of the logic, it will get handled later.
        if (updatedPath.indexOf('$') !== -1) {
          continue;
        }
        if (key === '$set' || key === '$setOnInsert' ||
            key === '$pull' || key === '$pullAll') {
          updatedValues[updatedPath] = flat[paths[j]];
          isPull[updatedPath] = key === '$pull' || key === '$pullAll';
        } else if (key === '$unset') {
          updatedValues[updatedPath] = undefined;
        }
        updatedKeys[updatedPath] = true;
      }
    }
  }

  if (!hasDollarUpdate) {
    modifiedPaths(castedDoc, '', modified);
    updatedValues = flatten(castedDoc);
    updatedKeys = Object.keys(updatedValues);
  }

  const updates = Object.keys(updatedValues);
  const numUpdates = updates.length;
  const validatorsToExecute = [];
  const validationErrors = [];
  function iter(i, v) {
    const schemaPath = schema._getSchema(updates[i]);
    if (schemaPath) {
      // gh-4305: `_getSchema()` will report all sub-fields of a 'Mixed' path
      // as 'Mixed', so avoid double validating them.
      if (schemaPath instanceof Mixed && schemaPath.$fullPath !== updates[i]) {
        return;
      }

      if (v && Array.isArray(v.$in)) {
        v.$in.forEach((v, i) => {
          validatorsToExecute.push(function(callback) {
            schemaPath.doValidate(
              v,
              function(err) {
                if (err) {
                  err.path = updates[i] + '.$in.' + i;
                  validationErrors.push(err);
                }
                callback(null);
              },
              options && options.context === 'query' ? query : null,
              {updateValidator: true});
          });
        });
      } else {
        if (isPull[updates[i]] &&
            !Array.isArray(v) &&
            schemaPath.$isMongooseArray) {
          v = [v];
        }

        validatorsToExecute.push(function(callback) {
          schemaPath.doValidate(
            v,
            function(err) {
              if (err) {
                err.path = updates[i];
                validationErrors.push(err);
              }
              callback(null);
            },
            options && options.context === 'query' ? query : null,
            {updateValidator: true});
        });
      }
    }
  }
  for (i = 0; i < numUpdates; ++i) {
    iter(i, updatedValues[updates[i]]);
  }

  const arrayUpdates = Object.keys(arrayAtomicUpdates);
  const numArrayUpdates = arrayUpdates.length;
  for (i = 0; i < numArrayUpdates; ++i) {
    (function(i) {
      let schemaPath = schema._getSchema(arrayUpdates[i]);
      if (schemaPath && schemaPath.$isMongooseDocumentArray) {
        validatorsToExecute.push(function(callback) {
          schemaPath.doValidate(
            arrayAtomicUpdates[arrayUpdates[i]],
            function(err) {
              if (err) {
                err.path = arrayUpdates[i];
                validationErrors.push(err);
              }
              callback(null);
            },
            options && options.context === 'query' ? query : null);
        });
      } else {
        schemaPath = schema._getSchema(arrayUpdates[i] + '.0');
        for (let j = 0; j < arrayAtomicUpdates[arrayUpdates[i]].length; ++j) {
          (function(j) {
            validatorsToExecute.push(function(callback) {
              schemaPath.doValidate(
                arrayAtomicUpdates[arrayUpdates[i]][j],
                function(err) {
                  if (err) {
                    err.path = arrayUpdates[i];
                    validationErrors.push(err);
                  }
                  callback(null);
                },
                options && options.context === 'query' ? query : null,
                { updateValidator: true });
            });
          })(j);
        }
      }
    })(i);
  }

  return function(callback) {
    parallel(validatorsToExecute, function() {
      if (validationErrors.length) {
        const err = new ValidationError(null);
        for (let i = 0; i < validationErrors.length; ++i) {
          err.addError(validationErrors[i].path, validationErrors[i]);
        }
        return callback(err);
      }
      callback(null);
    });
  };
};
