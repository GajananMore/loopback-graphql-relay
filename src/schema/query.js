'use strict';

const _ = require('lodash');

const {
	connectionArgs
} = require('graphql-relay');

const { GraphQLObjectType } = require('graphql');
const { getType, getConnection } = require('../types/type');
const { findAll } = require('../db');
const { connectionFromPromisedArray } = require('../db/resolveConnection');
const getRemoteMethods = require('./utils/getRemoteMethods');

/**
 *
 * @param {*} models
 */
function getRelatedModelFields(models) {
  const fields = {};

  _.forEach(models, (model) => {

    if (!model.shared) {
      return;
    }

    fields[_.lowerFirst(model.pluralModelName)] = {
      args: Object.assign({
        where: {
          type: getType('JSON')
        },
        order: {
          type: getType('JSON')
        },
      }, connectionArgs),
      type: getConnection(model.modelName),
      resolve: (obj, args, context) => connectionFromPromisedArray(findAll(model, obj, args, context), args, model)
    };
  });

  return fields;
}


function getMeField(userModelName) {
  if (userModelName) {
    return {
      me: {
        type: getType(userModelName),
        resolve: (obj, args, { app, req }) => {

          if (!req.headers.accesstoken) return null;

          return app.models[userModelName].findById(req.headers.accesstoken).then((user) => {
            user = user.toJSON();
            if (!user) return Promise.reject('No Account with this access token was found.');
            return Promise.resolve(user);
          });
        }
      }
    };
  }
  return {
    me: {
      type: getType('User'),
      resolve: (obj, args, { app, req }) => {

        if (!req.headers.accesstoken) return null;

        return app.models.User.findById(req.headers.accesstoken).then((user) => {
          user = user.toJSON();
          if (!user) return Promise.reject('No user with this access token was found.');
          return Promise.resolve(user);
        });
      }
    }
  };
}

/**
 * Generates Viewer query
 * @param {*} models
 */
function generateViewer(models, userModelName) {

  const Viewer = {
    resolve: (root, args, context) => ({}),
    type: new GraphQLObjectType({
      name: 'Viewer',
      description: 'Viewer',
      // interfaces: () => [nodeDefinitions.nodeInterface],
      fields: () => Object.assign({},
          getMeField(userModelName),
          getRelatedModelFields(models)
        )
    })
  };

  return Viewer;
}


function generateModelFields(models) {

  const modelFields = {};
  _.forEach(models, (model) => {

    const fields = Object.assign({},
      getRemoteMethods(model, ['get', 'head'])
    );

    if (_.size(fields) === 0) {
      return;
    }

    modelFields[_.upperFirst(model.modelName)] = {
      resolve: (root, args, context) => ({}),
      type: new GraphQLObjectType({
        name: `${model.modelName}Queries`,
        description: model.modelName,
        fields
      })
    };

  });

  return modelFields;
}

module.exports = function(models, userModelName) {

  const fields = Object.assign({},
    {
      node: getType('node'),
      viewer: generateViewer(models, userModelName)
    },
    generateModelFields(models)
  );

  return new GraphQLObjectType({
    name: 'Query',
    fields
  });
};
