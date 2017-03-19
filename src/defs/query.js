const _ = require('lodash');

const {
  connectionArgs,
	connectionFromPromisedArray
} = require('graphql-relay');

const { findRelated } = require('../db');

/** * Loopback Types - GraphQL types
        any - JSON
        Array - [JSON]
        Boolean = boolean
        Buffer - not supported
        Date - Date (custom scalar)
        GeoPoint - not supported
        null - not supported
        Number = float
        Object = JSON (custom scalar)
        String - string
    ***/

const types = {};

const SCALARS = {
  any: 'JSON',
  number: 'Float',
  string: 'String',
  boolean: 'Boolean',
  objectid: 'ID',
  date: 'Date',
  object: 'JSON',
  now: 'Date',
  guid: 'ID',
  uuid: 'ID',
  uuidv4: 'ID'
};

function getScalar(type) {
  return SCALARS[type.toLowerCase().trim()];
}

function toTypes(union) {
  return _.map(union, type => (getScalar(type) ? getScalar(type) : type));
}

/**
 * Generates definiton for the Viewer type
 * @param {*} models
 */
function generateViewer(models) {

  const Viewer = {
    generated: false,
    name: 'Viewer',
    description: 'Viewer',
		// interfaces: () => [nodeDefinitions.nodeInterface],
    meta: {
      category: 'TYPE',
      fields: {}
    },
  };

  _.forEach(models, (model) => {

    if (!model.shared) {
      return;
    }

    Viewer.meta.fields[_.lowerFirst(model.pluralModelName)] = {
      generated: false,
      meta: {
        relation: true,
        list: true,
        args: connectionArgs,
        type: model.modelName,
      }
    };
  });

  return Viewer;
}

/**
 * Generates a property definition for a model type
 * @param {*} model
 * @param {*} property
 * @param {*} propertyName
 */
function mapProperty(model, property, modelName, propertyName) {

  // If property is deprecated, ignore it.
  if (property.deprecated) {
    return;
  }

  // Bootstrap basic property object
  types[modelName].meta.fields[propertyName] = {
    generated: false,
    meta: {
      required: property.required,
      hidden: model.definition.settings.hidden && model.definition.settings.hidden.indexOf(propertyName) !== -1
    }
  };
  const currentProperty = types[modelName].meta.fields[propertyName];

  const typeName = `${modelName}_${propertyName}`;
  let propertyType = property.type;

  // If it's an Array type, map it to JSON Scalar
  if (propertyType.name === 'Array') { // JSON Array
    currentProperty.meta.list = true;
    currentProperty.meta.type = 'JSON';
    currentProperty.meta.scalar = true;
    return;
  }

  // If property.type is an array, its a list type.
  if (_.isArray(property.type)) {
    currentProperty.meta.list = true;
    propertyType = property.type[0];
  }

  // Add resolver
  currentProperty.resolve = (obj, args, context) => (_.isNil(obj[propertyName]) ? null : obj[fieldName]);

  // See if this property is a scalar.
  let scalar = getScalar(propertyType.name);

  if (property.defaultFn) {
    scalar = getScalar(property.defaultFn);
  }

  if (scalar) {
    currentProperty.meta.scalar = true;
    currentProperty.meta.type = scalar;

    if (property.enum) { // enum has a dedicated type but no input type is required
      types[typeName] = {
        generated: false,
        values: property.enum,
        meta: {
          category: 'ENUM'
        }
      };
      currentProperty.type = typeName;
    }
  }

  // If this property is another Model
  if (propertyType.name === 'ModelConstructor' && property.defaultFn !== 'now') {
    currentProperty.meta.type = propertyType.modelName;
    const union = propertyType.modelName.split('|');

    // type is a union
    if (union.length > 1) { // union type
      types[typeName] = { // creating a new union type
        generated: false,
        meta: {
          category: 'UNION'
        },
        values: toTypes(union)
      };
    } else if (propertyType.settings && propertyType.settings.anonymous && propertyType.definition) {
      currentProperty.gqlType = typeName;
      types[typeName] = {
        generated: false,
        meta: {
          category: 'TYPE',
          input: true,
          fields: {}
        }
      }; // creating a new type
      _.forEach(propertyType.definition.properties, (p, key) => {
        mapProperty(propertyType, p, typeName, key);
      });
    }
  }
}

/**
 * Maps a relationship as a connection property to a given type
 * @param {*} rel
 * @param {*} modelName
 * @param {*} relName
 */
function mapRelation(rel, modelName, relName) {
  types[modelName].meta.fields[relName] = {
    generated: false,
    meta: {
      relation: true,
      connection: true,
      relationType: rel.type,
      embed: rel.embed,
      type: rel.modelTo.modelName,
      args: Object.assign({
        active: {
          generated: false,
          type: 'JSON'
        },
      }, connectionArgs),
    },
    resolve: (obj, args, context) => connectionFromPromisedArray(findRelated(rel, obj, args, context), args)
  };
}

/**
 * Generates a definition for a single model type
 * @param {*} model
 */
function mapType(model) {
  types[model.modelName] = {
    generated: false,
    meta: {
      category: 'TYPE',
      input: true,
      fields: {}
    }
  };

  _.forEach(model.definition.properties, (property, key) => {
    mapProperty(model, property, model.modelName, key);
  });

  _.forEach(sharedRelations(model), (rel) => {
    mapRelation(rel, model.modelName, rel.name);
  });
}

function sharedRelations(model) {
  return _.pickBy(model.relations, rel => rel.modelTo && rel.modelTo.shared);
}

/**
 * building all models types & relationships
 */
module.exports = function abstractTypes(models) {
  types.Viewer = generateViewer(models);

  _.forEach(models, model => mapType(model));

  return types;
};
