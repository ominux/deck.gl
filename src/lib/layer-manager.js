
// IMLEMENTATION NOTES: Why new layers are created on every render
//
// The key here is to understand the declarative / functional
// programming nature of "reactive" applications.
//
// - In a reactive application, the entire "UI tree"
//   is re-rendered every time something in the application changes.
//
// - The UI framework (such as React or deck.gl) then diffs the rendered
//   tree of UI elements (React Elements or deck.gl Layers) against the
//   previously tree and makes optimized changes (to the DOM or to WebGL state).
//
// - Deck.gl layers are not based on React.
//   But it should be possible to wrap deck.gl layers in React components to
//   enable use of JSX.
//
// The deck.gl model that for the app creates a new set of on layers on every
// render.
// Internally, the new layers are efficiently matched against existing layers
// using layer ids.
//
// All calculated state (programs, attributes etc) are stored in a state object
// and this state object is moved forward to the match layer on every render
// cycle.  The new layer ends up with the state of the old layer (and the
// props of the new layer), while the old layer is simply discarded for
// garbage collecion.
//
/* eslint-disable no-try-catch */
import Layer from './layer';
import {log} from './utils';
import assert from 'assert';

export default class LayerManager {
  constructor() {
    this.prevLayers = [];
    this.layers = [];
    this.context = {};
    Object.seal(this.context);
  }

  updateLayers({newLayers}) {

    // Filter out any null layers
    newLayers = newLayers.filter(newLayer => newLayer !== null);

    for (const layer of newLayers) {
      layer.context = this.context;
    }

    this.prevLayers = this.layers;
    const {error, generatedLayers} = this._updateLayers({
      oldLayers: this.prevLayers,
      newLayers
    });

    this.layers = generatedLayers;
    // Throw first error found, if any
    if (error) {
      throw error;
    }
    return this;
  }

  // PRIVATE METHODS

  // Match all layers, checking for caught errors
  // To avoid having an exception in one layer disrupt other layers
  _updateLayers({oldLayers, newLayers}) {
    // Create old layer map
    const oldLayerMap = {};
    for (const oldLayer of oldLayers) {
      if (oldLayerMap[oldLayer.id]) {
        log.once(0, `Multipe old layers with same id ${layerName(oldLayer)}`);
      } else {
        oldLayerMap[oldLayer.id] = oldLayer;
      }
    }

    // Allocate array for generated layers
    const generatedLayers = [];

    // Match sublayers
    const error = this._matchSublayers({
      newLayers, oldLayerMap, generatedLayers
    });

    const error2 = this._finalizeOldLayers(oldLayers);
    const firstError = error || error2;
    return {error: firstError, generatedLayers};
  }

  /* eslint-disable max-statements */
  _matchSublayers({newLayers, oldLayerMap, generatedLayers}) {
    // Filter out any null layers
    newLayers = newLayers.filter(newLayer => newLayer !== null);

    let error = null;
    for (const newLayer of newLayers) {
      newLayer.context = this.context;

      try {
        // 1. given a new coming layer, find its matching layer
        const oldLayer = oldLayerMap[newLayer.id];
        oldLayerMap[newLayer.id] = null;

        if (oldLayer === null) {
          log.once(0, `Multipe new layers with same id ${layerName(newLayer)}`);
        }

        // Only transfer state at this stage. We must not generate exceptions
        // until all layers' state have been transferred
        if (oldLayer) {
          log(3, `matched ${layerName(newLayer)}`, oldLayer, '=>', newLayer);
          this._transferLayerState(oldLayer, newLayer);
          this._updateLayer(newLayer);
        } else {
          this._initializeNewLayer(newLayer);
        }
        generatedLayers.push(newLayer);

        // Call layer lifecycle method: render sublayers
        let sublayers = newLayer.getSubLayers();
        // End layer lifecycle method: render sublayers

        if (sublayers) {
          sublayers = Array.isArray(sublayers) ? sublayers : [sublayers];
          this._matchSublayers({
            newLayers: sublayers,
            oldLayerMap,
            generatedLayers
          });
        }
      } catch (err) {
        log.once(0,
          `deck.gl error during matching of ${layerName(newLayer)} ${err}`, err);
        // Save first error
        error = error || err;
      }
    }
    return error;
  }

  _transferLayerState(oldLayer, newLayer) {
    const {state, props} = oldLayer;

    // sanity check
    assert(state, 'deck.gl sanity check - Matching layer has no state');
    assert(oldLayer !== newLayer, 'deck.gl sanity check - Matching layer is same');

    // Move state
    newLayer.state = state;
    state.layer = newLayer;

    // Update model layer reference
    if (state.model) {
      state.model.userData.layer = newLayer;
    }
    // Keep a temporary ref to the old props, for prop comparison
    newLayer.oldProps = props;
    oldLayer.state = null;
  }

  // Update the old layers that were not matched
  _finalizeOldLayers(oldLayers) {
    let error = null;
    // Unmatched layers still have state, it will be discarded
    for (const layer of oldLayers) {
      if (layer.state) {
        error = error || this._finalizeLayer(layer);
      }
    }
    return error;
  }

  // Initializes a single layer, calling layer methods
  _initializeNewLayer(layer) {
    let error = null;
    // Check if new layer, and initialize it's state
    if (!layer.state) {
      log(1, `initializing ${layerName(layer)}`);
      try {
        layer.initializeLayer({
          oldProps: {},
          props: layer.props,
          oldContext: this.oldContext,
          context: this.context
        });
      } catch (err) {
        log.once(0, `deck.gl error during initialization of ${layerName(layer)} ${err}`, err);
        // Save first error
        error = error || err;
      }
      // // Set back pointer (used in picking)
      // if (layer.state) {
      //   layer.state.layer = layer;
      //   // Save layer on model for picking purposes
      //   // TODO - store on model.userData rather than directly on model
      // }
      // if (layer.state && layer.state.model) {
      //   layer.state.model.userData.layer = layer;
      // }
    }
    return error;
  }

  // Updates a single layer, calling layer methods
  _updateLayer(layer) {
    const {oldProps, props} = layer;
    let error = null;
    if (oldProps) {
      try {
        layer.updateLayer({
          oldProps,
          props,
          context: this.context,
          oldContext: this.oldContext
        });
      } catch (err) {
        log.once(0, `deck.gl error during update of ${layerName(layer)}`, err);
        // Save first error
        error = err;
      }
      log(2, `updating ${layerName(layer)}`);
    }
    return error;
  }

  // Finalizes a single layer
  _finalizeLayer(layer) {
    let error = null;
    const {state} = layer;
    if (state) {
      try {
        layer.finalizeLayer();
      } catch (err) {
        log.once(0,
          `deck.gl error during finalization of ${layerName(layer)}`, err);
        // Save first error
        error = err;
      }
      layer.state = null;
      log(1, `finalizing ${layerName(layer)}`);
    }
    return error;
  }

  processPickingAction({ray}) {
    for (const layer of this.layers) {
      if (layer.props.pickable === true) {
        const result = layer.pickingWithRay({ray});
        this.controller.processPickingResult({
          layer: layer,
          result: result
        });
      }
    }
  }

  getDirtyProperties() {
    const propertiesToUpdate = [];
    for (const layer of this.layers) {
      for (const mesh of layer.state.meshes.values()) {
        for (const property of mesh.properties.values()) {
          if (property.dirty === true) {
            propertiesToUpdate.push({mesh, property});
          }
        }
      }
    }
    return propertiesToUpdate;
  }
}

function layerName(layer) {
  if (layer instanceof Layer) {
    return `${layer}`;
  }
  return !layer ? 'null layer' : 'invalid layer';
}
