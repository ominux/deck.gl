export class Graph {
  constructor({parentGraph} = {}) {
    this.nodes = new Map();
    this.edges = new Map();

    // Helper tables
    // node id -> node index. This is useful for constructing edge line indices
    this.nodeIndexMap = new Map();
    // node index -> node. This is useful for picking
    this.nodeMap = new Map();

    this.edgeIndexMap = new Map();
    this.edgeIDMap = new Map();

    this.edgeNodeIndex = new Array();

    this.numberOfNodes = 0;
    this.numberOfEdges = 0;

    this.parentGraph = parentGraph;
    this.isSubGraph = parentGraph ? true : false;

    this.layout = null;
    this.layoutRunning = false;

    this.dataStructureChanged = false;
    this.dataChanged = false;

    setInterval(this.layoutStep.bind(this), 16);

  }

  addNode(node) {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node);
      this.numberOfNodes++;
      this.dataStructureChanged = true;
    }
  }

  addEdge(edge) {
    if (!this.edges.has(edge.id)) {
      this.edges.set(edge.id, edge);
      this.numberOfEdges++;
      this.dataStructureChanged = true;
    }
  }

  _resetDistance() {
    for (const node in this.nodes.values()) {
      node.distance = Infinity;
    }
    for (const edge in this.edges.values()) {
      edge.distance = Infinity;
    }
  }

  setLayout(layout) {
    this.layout = layout;
  }

  layoutStep() {
    if (this.layoutRunning) {
      this.layout.step();
      this.dataChanged = true;
    }
  }

  startLayout() {
    this.layoutRunning = true;
  }

  pauseLayout() {
    this.layoutRunning = false;
  }

  resetLayout() {

  }

  isDataChanged() {
    return this.isDataChanged;
  }

  isDataStructureChanged() {
    return this.isDataStructureChanged;
  }

  generateSubGraph({startNodeID, numHops = 3}) {

    if (startNodeID === undefined) {
      let maxEdge = 0;
      let maxNodeID;

      for (const [key, node] of this.nodes) {
        if (node.degree > maxEdge && node.attributes.type === 'driver') {
          maxEdge = node.adjacentSet.size;
          maxNodeID = key;
        }
      }
      startNodeID = maxNodeID;
    }

    this._resetDistance();

    this.subGraph = new Graph({parentGraph: this});
    let nodeCount = 0;
    let edgeCount = 0;

    // Breadth first search for the first 'this.state.numHops' nodes from the start node
    const root = this.nodes.get(startNodeID);
    root.distance = 0;

    const queue = [root];
    while (queue.length !== 0) {
      const current = queue.shift();
      if (current.distance > numHops) {
        break;
      }
      this.subGraph.nodeIndexMap.set(current.id, nodeCount);
      this.subGraph.nodeMap.set(nodeCount, current);
      this.subGraph.nodes.set(current.id, current);
      nodeCount++;

      for (const item of current.adjacentSet) {
        if (item.distance === Infinity) {
          item.distance = current.distance + 1;
          queue.push(item);
        }
        const edge = this._getEdgeIDFromNodes(this.edges, current, item);

        if(edge && !this.subGraph.edgeIndexMap.has(edge.id)) {
          this.subGraph.edgeIndexMap.set(edge.id, edgeCount);
          this.subGraph.edgeIDMap.set(edgeCount, edge.id);
          this.subGraph.edges.set(edge.id, edge);

          edgeCount++;
        }
      }
    }

    // TODO:
    // build edgeNodeIndex array for faster force calculations

    for (const edge of this.subGraph.edges.values()) {
      const node0Index = this.subGraph.nodeIndexMap.get(edge.node0.id);
      const node1Index = this.subGraph.nodeIndexMap.get(edge.node1.id);
      if (node0Index !== undefined && node1Index !== undefined) {
        this.subGraph.edgeNodeIndex.push(node0Index);
        this.subGraph.edgeNodeIndex.push(node1Index);
      }
    }


    this.subGraph.numberOfNodes = nodeCount;

    // Process edges

    this.subGraph.numberOfEdges = edgeCount;
    //console.log('subGraph', subGraph);
    return this.subGraph;
  }

  getNodePosition() {
    return this.layout.getNodePosition();
  }

  getNodeColor() {
    return this.layout.getNodeColor();
  }

  getNodeSize() {
    return this.layout.getNodeSize();
  }

  getEdgePosition() {
    return this.layout.getEdgePosition();
  }

  getEdgeColor() {
    return this.layout.getEdgeColor();
  }

  getEdgeNodeIndex() {
    return this.edgeNodeIndex;
  }


  _getEdgeIDFromNodes(edges, node1, node2) {
    if (edges.has(`${node1.id}_${node2.id}`)) {
      return edges.get(`${node1.id}_${node2.id}`);
    }
    if (edges.has(`${node2.id}_${node1.id}`)) {
      return edges.get(`${node2.id}_${node1.id}`);
    }
    return undefined;
  }

  _isEdgeInGraph(graph, node1, node2) {
    return graph.edgeSet.has(`${node1.id}_${node2.id}`) ||
     graph.edgeSet.has(`${node2.id}_${node1.id}`);
  }
}

export class GraphNode {
  constructor({id, type}) {
    this.id = id;
    this.adjacentSet = new Set();
    this.distance = Infinity;
    this.degree = 0;
    this.attributes = {type};
  }

  addAdjacentNode(node) {
    this.adjacentSet.add(node);
    this.degree++;
  }

  addAttributes({entry}) {
  }
}

export class GraphEdge {
  constructor({id, node0, node1, type}) {
    this.id = id;
    this.node0 = node0;
    this.node1 = node1;
    this.distance = Infinity;
    this.attributes = {type, strength: 1};
  }
}



class GraphLayout {
  constructor({id, graph}) {
    this.id = id;
    this.graph = graph;
  }

  gaussRandom() {
    const u = 2 * Number(Math.random()) - 1;
    const v = 2 * Number(Math.random()) - 1;
    const r = u * u + v * v;
    if (r === 0 || r > 1) {
      return this.gaussRandom();
    }
    const c = Math.sqrt(-2 * Math.log(r) / r);
    return v * c;
  }

  randn(mu, std) {
    return mu + this.gaussRandom() * std;
  }
}

export class GraphLayoutForceDirected extends GraphLayout {
  constructor({id, graph, dof}) {
    super({id, graph});

    this.graph = graph;
    this.numberOfNodes = this.graph.numberOfNodes;

    this.startStep = 0;
    this.currentStep = 0;
    this.startTime = new Date();
    this.currentTime = this.startTime;

    this.dof = dof;
    this.dt = 0.0;
    this.ka = 1e-3;
    this.kr2 = 1e-3;
    this.ks = 1e-3;
    this.ks2 = 1e-2;
    this.dt = 10;
    this.damping = 0.95;
    this.balanceLength = 4;

    this.position = new Array(this.numberOfNodes);
    this.color = new Array(this.numberOfNodes);
    this.size = new Array(this.numberOfNodes);
    this.mass = new Array(this.numberOfNodes);
    this.edgePosition = new Array(this.numberOfEdges);

    for (const [index, node] of this.graph.nodeMap) {
      this.position[index] = this._initializeNodePosition(node, index);
      this.color[index] = this._initializeNodeColor(node, index);
      this.size[index] = this._initializeNodeSize(node, index);
      this.mass[index] = this._initializeNodeMass(node, index);
    }

    this.distance = new Float64Array(this.numberOfNodes * this.numberOfNodes);

    this.direction = new Float64Array(this.numberOfNodes * this.numberOfNodes * this.dof);

    this.acceleration = new Float64Array(this.numberOfNodes * this.dof);

    this.velocity = new Float64Array(this.numberOfNodes * this.dof);

    this.ymean = new Float64Array(this.dof);

    for (let i = 0; i < this.velocity.length * this.dof; i++) {
      this.velocity[i] = this.randn(0, 1);
    }
  }

  step() {
    if (this.currentStep > 100 && this.dt < 5e1) {
        this.dt *= 1.005;
    }

    this._calculateAcceleration();

    const ymean = this.ymean;
    for (let d = 0; d < this.dof; d++) {
      ymean[d] = 0;
    }
    for (let i = 0; i < this.numberOfNodes; i++) {
      for (let d = 0; d < this.dof; d++) {
        this.position[i][d] += this.velocity[i * this.dof + d];
        ymean[d] += this.position[i][d];
      }
    }

    for (let i = 0; i < this.numberOfNodes; i++) {
      for (let d = 0; d < this.dof; d++) {
        // if (this.L2(this.position[i], [0, 0, 0]) < 20) {
          this.position[i][d] -= ymean[d] / this.numberOfNodes;
        // }
      }
    }

    this.currentStep++;
  }

  getNodePosition() {
    return this.position;
  }

  getNodeColor() {
    return this.color;
  }

  getNodeSize() {
    return this.size;
  }

  getEdgePosition() {
    return this.edgePosition;
  }

  _L2(a, b) {
    const D = a.length;
    let d = 0;
    for (let i = 0; i < D; i++) {
      const ai = a[i];
      const bi = b[i];

      d += (ai - bi) * (ai - bi);
    }
    return d;
  }

  _xtod(dist, direction, data) {
    const N = this.numberOfNodes;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const d = Math.sqrt(this._L2(data[i], data[j]));
        dist[i * N + j] = d;
        dist[j * N + i] = d;
        for (let k = 0; k < this.dof; k++) {
          direction[i * N * this.dof + j * this.dof + k] = (data[i][k] - data[j][k]) / d;
          direction[j * N * this.dof + i * this.dof + k] = -direction[i * N * this.dof + j * this.dof + k];
        }
      }
    }
  }



  _calculateAcceleration() {

    this._processNodeInteractions();
    this._processEdgeInteractions();

    for (let i = 0; i < this.numberOfNodes; i++) {
      for (let d = 0; d < this.dof; d++) {
        this.velocity[i * this.dof + d] += this.acceleration[i * this.dof + d] * this.dt;
        this.velocity[i * this.dof + d] *= this.damping;
      }
    }
  }

  _processNodeInteractions() {
    this._xtod(this.distance, this.direction, this.position);

    for (let i = 0; i < this.numberOfNodes; i++) {
      const gsum = this.ymean;

      for (let d = 0; d < this.dof; d++) {
        gsum[d] = 0.0;
      }

      for (let j = 0; j < this.numberOfNodes; j++) {
        if (i === j) continue;
        let F = 0;

        const dist = this.distance[i * this.numberOfNodes + j];
        const dist2 = this.distance[i * this.numberOfNodes + j] * this.distance[i * this.numberOfNodes + j];
        const distBoundary = dist - (this.size[i] + this.size[j]);

        if (distBoundary > 0) {
          F = (this.kr2 / dist2) * this.mass[j];
        } else {
          F = -this.ks2 * distBoundary;
        }
        for (let d = 0; d < this.dof; d++) {
          gsum[d] += F * (this.direction[i * this.numberOfNodes * this.dof + j * this.dof + d]);
        }
        gsum[2] += -this.ka * this.direction[i * this.numberOfNodes * this.dof + j * this.dof + 2];
      }

      for (let d = 0; d < this.dof; d++) {
        this.acceleration[i * this.dof + d] = gsum[d];
      }
    }
  }

  _processEdgeInteractions() {
    for (let i = 0; i < this.graph.edgeNodeIndex.length / 2; i++) {
      let F0, F1 = 0;
      const node0Idx = this.graph.edgeNodeIndex[i * 2 + 0];
      const node1Idx = this.graph.edgeNodeIndex[i * 2 + 1];

      const dist = this.distance[node0Idx * this.numberOfNodes + node1Idx];

      F0 = (this.balanceLength - dist) * this.ks * (this.mass[node1Idx]);
      F1 = (this.balanceLength - dist) * this.ks * (this.mass[node0Idx]);

      for (let d = 0; d < this.dof; d++) {
        this.acceleration[node0Idx * this.dof + d] += F0 * (this.direction[node0Idx * this.numberOfNodes * this.dof + node1Idx * this.dof + d]);
        this.acceleration[node1Idx * this.dof + d] += F1 * (this.direction[node1Idx * this.numberOfNodes * this.dof + node0Idx * this.dof + d]);
      }
    }
  }

  _initializeNodePosition(node, index) {
    const ret = new Array(this.dof);
    for (let i = 0; i < this.dof; i++) {
      ret[i] = this.randn(0, 2);
      if (i === 2) {
        ret[i] *= 2;
      }
    }
    return ret;
  }

  _initializeNodeSize(node, index) {
    // if (node.type === 'device') {
    //   return node.degree / 10;
    // }
    // return node.degree / 20;
    return 0.3;
  }

  _initializeNodeMass(node, index) {
    if (node.type === 'device') {
      return node.degree * 2;
    }
    return node.degree / 10;
  }

  _initializeNodeColor(node, index) {
    let color;
    switch (node.attributes.type) {
    case 'driver':
      color = [228, 26, 28, 255]; // purple
      break;
    case 'rider':
      color = [55, 126, 184, 255]; // blue
      break;
    case 'user':
      color = [128, 128, 128, 255]; // grey
      break;
    case 'device':
      color = [253, 191, 111, 255]; // yellow
      break;
    case 'trip':
      color = [0, 255, 0, 255]; // green
      break;
    default:
      color = [255, 255, 255, 255];
    }
    color = color.map(x => x / 255);
    return color;
  }

  _initializeEdgeColor(edge) {
    let color;
    switch (edge.attributes.type) {
    case 'user_trip':
      color = [0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0]; // blue
      break;
    case 'user_device':
      color = [1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 0.0, 1.0]; // yellow
      break;
    default:
      color = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
    }
    return color;
  }

}
