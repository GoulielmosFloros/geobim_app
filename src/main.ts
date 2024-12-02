import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import maplibregl, { LngLatLike, CustomLayerInterface, FillExtrusionLayerSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css"
import { GLTFLoader } from "three/examples/jsm/Addons.js"
import projectInformation from "./components/Panels/ProjectInformation";
import elementData from "./components/Panels/Selection";
import settings from "./components/Panels/Settings";
import load from "./components/Toolbars/Sections/Import";
import help from "./components/Panels/Help";
import camera from "./components/Toolbars/Sections/Camera";
import selection from "./components/Toolbars/Sections/Selection";
import { AppManager } from "./bim-components";

BUI.Manager.init();

const components = new OBC.Components();
const worlds = components.get(OBC.Worlds);

const world = worlds.create<
  OBC.SimpleScene,
  OBC.OrthoPerspectiveCamera,
  OBF.PostproductionRenderer
>();
world.name = "Main";

world.scene = new OBC.SimpleScene(components);
world.scene.setup();
world.scene.three.background = null;

const viewport = BUI.Component.create<BUI.Viewport>(() => {
  return BUI.html`
    <bim-viewport>
      <bim-grid floating></bim-grid>
    </bim-viewport>
  `;
});

world.renderer = new OBF.PostproductionRenderer(components, viewport);
const { postproduction } = world.renderer;

world.camera = new OBC.OrthoPerspectiveCamera(components);

const worldGrid = components.get(OBC.Grids).create(world);
worldGrid.material.uniforms.uColor.value = new THREE.Color(0x424242);
worldGrid.material.uniforms.uSize1.value = 2;
worldGrid.material.uniforms.uSize2.value = 8;

const resizeWorld = () => {
  world.renderer?.resize();
  world.camera.updateAspect();
};

viewport.addEventListener("resize", resizeWorld);

components.init();

postproduction.enabled = true;
postproduction.customEffects.excludedMeshes.push(worldGrid.three);
postproduction.setPasses({ custom: true, ao: true, gamma: true });
postproduction.customEffects.lineColor = 0x17191c;

const appManager = components.get(AppManager);
const viewportGrid = viewport.querySelector<BUI.Grid>("bim-grid[floating]")!;
appManager.grids.set("viewport", viewportGrid);

const fragments = components.get(OBC.FragmentsManager);
const indexer = components.get(OBC.IfcRelationsIndexer);
const classifier = components.get(OBC.Classifier);
classifier.list.CustomSelections = {};

const ifcLoader = components.get(OBC.IfcLoader);
await ifcLoader.setup();

const tilesLoader = components.get(OBF.IfcStreamer);
tilesLoader.url = "../resources/tiles/";
tilesLoader.world = world;
tilesLoader.culler.threshold = 10;
tilesLoader.culler.maxHiddenTime = 1000;
tilesLoader.culler.maxLostTime = 40000;

const highlighter = components.get(OBF.Highlighter);
highlighter.setup({ world });
highlighter.zoomToSelection = true;

const culler = components.get(OBC.Cullers).create(world);
culler.threshold = 5;

world.camera.controls.restThreshold = 0.25;
world.camera.controls.addEventListener("rest", () => {
  culler.needsUpdate = true;
  tilesLoader.culler.needsUpdate = true;
});

fragments.onFragmentsLoaded.add(async (model) => {
  if (model.hasProperties) {
    await indexer.process(model);
    classifier.byEntity(model);
  }

  for (const fragment of model.items) {
    world.meshes.add(fragment.mesh);
    culler.add(fragment.mesh);
  }

  world.scene.three.add(model);
  setTimeout(async () => {
    world.camera.fit(world.meshes, 0.8);
  }, 50);
});

fragments.onFragmentsDisposed.add(({ fragmentIDs }) => {
  for (const fragmentID of fragmentIDs) {
    const mesh = [...world.meshes].find((mesh) => mesh.uuid === fragmentID);
    if (mesh) world.meshes.delete(mesh);
  }
});

const projectInformationPanel = projectInformation(components);
const elementDataPanel = elementData(components);

const app = document.getElementById("app") as BUI.Grid;

// Function to alternate between the templates.
const toggleMap = () => {
  if (app.layout === "map") {
    app.layout = "main";
  } else {
	  // When we are in main mode, that means we are in the apps normal view.
	  // We want to get rid of the model because we are uploading it each time
	  // we go from the map to the view.
    for (const [_, model] of fragments.groups.entries()) {
      fragments.disposeGroup(model);
    }
    app.layout = "map";
  }
};

// A simple section to go to the map again.
const mapSection = BUI.Component.create<BUI.ToolbarSection>(() => {
  return BUI.html`
   <bim-toolbar-section label="Map Libre">
    <bim-button label='View Map' id="mapButton" icon="simple-icons:homeadvisor" @click="${toggleMap}">
    </bim-button>
   </bim-toolbar-section>
  `;
});

const toolbar = BUI.Component.create(() => {
  return BUI.html`
    <bim-toolbar>
      ${load(components)}
      ${camera(world)}
      ${selection(components, world)}
      ${mapSection}
    </bim-toolbar>
  `;
});

const leftPanel = BUI.Component.create(() => {
  return BUI.html`
    <bim-tabs switchers-full>
      <bim-tab name="project" label="Project" icon="ph:building-fill">
        ${projectInformationPanel}
      </bim-tab>
      <bim-tab name="settings" label="Settings" icon="solar:settings-bold">
        ${settings(components)}
      </bim-tab>
      <bim-tab name="help" label="Help" icon="material-symbols:help">
        ${help}
      </bim-tab>
    </bim-tabs> 
  `;
});

const map = document.getElementById("map") as HTMLDivElement;

app.layouts = {
  main: {
    template: `
      "leftPanel viewport" 1fr
      /26rem 1fr
    `,
    elements: {
      leftPanel,
      viewport,
    },
  },
  map: {
    template: `
    "map"
    `,
    elements: {
      map,
    },
  },
};

app.layout = "map";

viewportGrid.layouts = {
  main: {
    template: `
      "empty" 1fr
      "toolbar" auto
      /1fr
    `,
    elements: { toolbar },
  },
  second: {
    template: `
      "empty elementDataPanel" 1fr
      "toolbar elementDataPanel" auto
      /1fr 24rem
    `,
    elements: {
      toolbar,
      elementDataPanel,
    },
  },
};

viewportGrid.layout = "main";

const coords: LngLatLike = [-75.602267, 6.206761];

const mapLibre = new maplibregl.Map({
  container: "map",
  style: "https://api.maptiler.com/maps/openstreetmap/style.json?key=bNj34ZiztD9jASNubRqO",
  center: coords,
  zoom: 18,
  pitch: 45,
  bearing: -17.6
})

const modelAltitude = 20; // Altitude from the ground.
// These rotations align the model to fit the map's coordinate system:
//   - Math.PI / 2 (90 degrees) rotates it to face the correct X-axis.
//   - 0.75 radians (~43 degrees) adjusts for its specific tilt on the Y-axis.
//   - No Z-axis rotation (0 radians) because it's already aligned in that axis.
const modelRotate = [Math.PI / 2, 0.75, 0];

// MapLibre uses Mercator coordinates for positioning objects, so we need to 
// convert the model's geographic position (longitude and latitude) to Mercator coordinates.
const modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat(
  coords,
  modelAltitude,
); // For Map Libre to add the data, it needs to be in Mercator Coordinates.

// This makes it easier to pass and reuse all the necessary transformations 
// (position, rotation, scale) throughout the code.
const modelTransform = {
  translateX: modelAsMercatorCoordinate.x,
  translateY: modelAsMercatorCoordinate.y,
  translateZ: modelAsMercatorCoordinate.z,
  rotateX: modelRotate[0],
  rotateY: modelRotate[1],
  rotateZ: modelRotate[2],
  scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits() * 100,
  // The 100 by the end is also specific to my model.
};

// We are creating a new instance of the ThreeJS elements
// This is done because we are going to create an scene as a layer.
const layerCamera = new THREE.Camera();
const layerScene = new THREE.Scene();
const layerRenderer = new THREE.WebGLRenderer({
  canvas: mapLibre.getCanvas(),
  context: mapLibre.getCanvas().getContext("webgl") as WebGLRenderingContext,
  antialias: true,
  alpha: true,
});

// And that layer will later be added to the map.

// Here we are creating our custom layer object
const customLayer: CustomLayerInterface = {
    // Its unique id.
  id: "3dmodel",
  // An entirely customized layer for us to create.
  type: "custom",
  renderingMode: "3d",
  onAdd() {
	//When added to the map, we will create two lights to illuminate our model
    const directionalLight = new THREE.DirectionalLight(0xffffff);
    directionalLight.position.set(0, -70, 100).normalize();
    layerScene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff);
    directionalLight2.position.set(0, 70, 100).normalize();
    layerScene.add(directionalLight2);

	// We'll use the gltf loader to get our glb file into the map
	// You can use both formats.
    // const loader = new GLTFLoader();

    // loader.load("../building.glb", (gltf) => {
    //   layerScene.add(gltf.scene);
    // });

    layerRenderer.autoClear = false;
  },
  render(_, matrix) {
    // Rotations are applied separately for each axis to account for the model's orientation.
    // These matrices store how much to rotate around each axis.
    const rotationX = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(1, 0, 0),
      modelTransform.rotateX,
    );
    const rotationY = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 1, 0),
      modelTransform.rotateY,
    );
    const rotationZ = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 0, 1),
      modelTransform.rotateZ,
    );

    // The map's projection matrix transforms 3D positions into 2D screen space, 
    // ensuring the model aligns with the map's perspective.
    const projectionMatrix = new THREE.Matrix4().fromArray(matrix);

    // Instead of applying transformations one by one, we combine them to 
    // improve performance and simplify rendering logic.
    const transformationMatrix = new THREE.Matrix4()
      .makeTranslation(
        modelTransform.translateX,
        modelTransform.translateY,
        modelTransform.translateZ,
      )
      .scale(
        new THREE.Vector3(
          modelTransform.scale,
          -modelTransform.scale,
          modelTransform.scale,
        ),
      )
      .multiply(rotationX)
      .multiply(rotationY)
      .multiply(rotationZ);

    // This matrix ensures that the model appears in the correct location, size,
    // and orientation when rendered on the map.
    layerCamera.projectionMatrix =
      projectionMatrix.multiply(transformationMatrix);
    // This clears any previous transformations or settings that could interfere with rendering.
    layerRenderer.resetState();
    // This step draws the model on the map, applying all the transformations.
    layerRenderer.render(layerScene, layerCamera);
    // This ensures that the updated model rendering is displayed immediately on the map.
    mapLibre.triggerRepaint();
  },
};

const fill3dBuildingsLayer: FillExtrusionLayerSpecification = {
    'id': '3d-buildings',
    'source': 'openmaptiles',
    'source-layer': 'building',
    'type': 'fill-extrusion',
    'minzoom': 15,
    'filter': ['!=', ['get', 'hide_3d'], true],
    'paint': {
        'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['get', 'render_height'], 0, 'lightgray', 200, 'royalblue', 400, 'lightblue'
        ],
        'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            0,
            16,
            ['get', 'render_height']
        ],
        'fill-extrusion-base': ['case',
            ['>=', ['get', 'zoom'], 16],
            ['get', 'render_min_height'], 0
        ]
    }
};

mapLibre.on("style.load", () => {

    mapLibre.addLayer(customLayer);

    mapLibre.addLayer(fill3dBuildingsLayer);
});


// Create an event for load
mapLibre.on("load", async () => {

    // Create PopUp Button
    const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false
    });

    // Add the marker from map libre's assets
    const image = await mapLibre.loadImage(
        "https://maplibre.org/maplibre-gl-js/docs/assets/custom_marker.png",
    );

    // Add the image.
    // First argument is the id and it will be used
    // To reference and link this element with others.
    mapLibre.addImage("custom-marker", image.data);

    // This is a source of information.
    // Describe the parameters of the marker in a geojson format
    // Again, the first argument is an id to use as reference in the next steps.
    mapLibre.addSource("mymodel", {
        type: "geojson",
        data: {
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: coords,
            },
            properties: {
                popupDescription: '<p>Name: Project A<br>Location: Colombia</p>',
            },
        },
    });

    // We'll use the add layer to link it all together.
    mapLibre.addLayer({
        // Refrence the ids created before.
        id: "mymodel",
        type: "symbol",
        source: "mymodel",
        layout: {
            "icon-image": "custom-marker",
            "icon-overlap": "always",
        },
    });

    // Add the event to load your model when the marker is clicked
    mapLibre.on("click", "mymodel", async () => {
        const file = await fetch("../NAV-IPI-ET1_E03-ZZZ-M3D-EST.ifc");
        const data = await file.arrayBuffer();
        const buffer = new Uint8Array(data);
        await ifcLoader.load(buffer);

        toggleMap();
    });

    // Some styling options to have the pointer look better
    mapLibre.on("mouseenter", "mymodel", (e) => {
        mapLibre.getCanvas().style.cursor = "pointer";
        if (!(e.features[0].properties.popupDescription)) return;

        const coordinates = e.features[0].geometry.coordinates.slice();
        const description = e.features[0].properties.popupDescription;

        // Ensure that if the map is zoomed out such that multiple
        // copies of the feature are visible, the popup appears
        // over the copy being pointed to.
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        // Populate the popup and set its coordinates
        // based on the feature found.
        popup.setLngLat(coordinates).setHTML(description).addTo(mapLibre);
    });

    mapLibre.on("mouseleave", "mymodel", () => {
        mapLibre.getCanvas().style.cursor = "";
        popup.remove();
    });
});