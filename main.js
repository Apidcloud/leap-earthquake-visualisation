import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader';

const plyModelPath = '/earthquakes-model/earthquakes.ply'

// the minimum hand velocity to manually rotate with 1 hand
const dragVelocityThreshold = 100;

// simple interaction (1 hand) rolling speed 
const rollSpeed = 0.01;

// angle adjustements when doing a fist
const rollAngleFactor = 20;
const pitchAngleFactor = 40;
const yawAngleFactor = 40;

// speed adjustment when hand is open
const autoAngleSpeedFactor = 100;

let leapInfo = null;
let isServerConnected = null;
let leapController = null;
let isLeapConnected = null;
let options = null;

// used to save last rotation and initial fallback value (when leap hasn't been used yet)
let lastRotation = [20, 30, 10];

// used to save last hand positions when using 2 hand interaction
let finalHandQuatRotation = new THREE.Quaternion();
let hand2QuatRotation = new THREE.Quaternion();
let lastPositions = null;

let euler = new THREE.Euler();

// line helper variables
//let vertArray = null;
//let lineGeometry = null;

// arrow helper variables
/* let arrow = null;
let dir = new THREE.Vector3();
let vFar = new THREE.Vector3();
let raycaster = new THREE.Raycaster(); */

function main() {
  const canvas = document.querySelector('#canvas');
  const renderer = new THREE.WebGLRenderer({canvas});

  const fov = 65;
  const aspect = 2;  // the canvas default
  const near = 0.1;
  const far = 1000;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(0, 0, 150);
  
  const clock = new THREE.Clock();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x72645b);

  /* lineGeometry = new THREE.Geometry();
	vertArray = lineGeometry.vertices;
	vertArray.push( new THREE.Vector3(-50, -100, 30), new THREE.Vector3(-150, 50, 70) );
	let lineMaterial = new THREE.LineBasicMaterial( { color: 0x00cc00 } );
  let line = new THREE.Line( lineGeometry, lineMaterial );
  line.computeLineDistances(); 
  scene.add(line); */

  // arrow helper
  /* arrow = new THREE.ArrowHelper(raycaster.ray.direction, raycaster.ray.origin, 100, 0x00cc00 );
  scene.add(arrow); */

  // PLY file
  const loader = new PLYLoader();
  let group = new THREE.Object3D();

  loader.load(plyModelPath, function ( geometry ) {

    const material = new THREE.PointCloudMaterial({
      color: 0xffffff,
      size: 0.4,
      opacity: 0.8,
      transparent: true,
      blending: THREE.AdditiveBlending,
      map: generateSprite()
  });

    group = new THREE.PointCloud(geometry, material);
    group.sortParticles = true;
    // adjust initial rotation
    group.rotateX(180);
    scene.add(group);

    prepareLeapMotion();
  });

  function render() {
    if (resizeRendererToDisplaySize(renderer)) {
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }

    // update leap motion connectivity information
    updateLeapInfo();

    // handle interaction with leap motion
    handleInteraction(clock.getDelta(), group);
    
    renderer.render(scene, camera);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

main();

function prepareLeapMotion()
{
	isServerConnected = false;
	isLeapConnected = true;
	options = {frameEventName: 'animationFrame', enableGestures: false};

	// give initial feedback regarding leap motion controller
	updateLeapInfo();

	leapController = new Leap.Controller(options);
	leapController.connect();

	leapController.on('deviceStopped', (function(){
		isLeapConnected = false;
		updateLeapInfo();
	}));

	leapController.on('connect', (function()
	{
		isServerConnected = true;
		updateLeapInfo();
	}));
}

function updateLeapInfo()
{
  isLeapConnected = leapController != null ? leapController.streaming() : isLeapConnected;
  leapInfo = document.getElementById('leapInfo'); 

	if(!isServerConnected)
	{
		leapInfo.innerHTML = 'Waiting for the Leap Motion Controller server...';
		leapInfo.style.display = 'block';
	}
	else if(isLeapConnected)
	{
		leapInfo.innerHTML = '';
		leapInfo.style.display = 'none';
	}
	else if(!isLeapConnected)
	{
		leapInfo.innerHTML = 'Please connect your Leap Motion Controller if you want to use it.';
		leapInfo.style.display = 'block';
	}
}

function generateSprite() {
  let canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  let context = canvas.getContext('2d');
  let gradient = context.createRadialGradient(canvas.width / 2, canvas.height / 2, 0, canvas.width / 2, canvas.height / 2, canvas.width / 2);
  gradient.addColorStop(0, 'rgba(0,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(0,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(0,0,64,1)');
  gradient.addColorStop(1, 'rgba(0,0,0,1)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  let texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function getHandsPositionFromFrame(frame){
    //console.log("Frame event for frame " + frame.id);

    if (frame === null){
      return null;
    }

    // we need at least 2 hands to be present
    if(!isLeapConnected || !frame.valid || frame.id === 0 ||frame.hands.length < 2) {
    	return null;
    }

    //console.log(frame.hands[0]);

    return [frame.hands[0].palmPosition, frame.hands[1].palmPosition];
}

function getRotationFromFrame(frame)
{
	  //console.log("Frame event for frame " + frame.id);

    if (frame === null){
      return null;
    }

    if(!isLeapConnected || !frame.valid || frame.id === 0) {
    	return null;
    }

  	// Retrieves first hand - no need to get it by ID, since we're not fetching hand based time behaviour
  	if (frame.hands.length === 0) {
      // default rotation when no hands are present
  		return null;
    }

    let yaw = 0, pitch = 0, roll = 0;

    // 1 hand scenario
    if (frame.hands.length === 1){
      // get hand
      const hand = frame.hands[0];
      
      // if a fist is being done, manually control the rotation of the object
      if (extendedFingersCount(hand) === 0) {
        yaw = getManualYaw(hand);
        pitch = getManualPitch(hand);
      }
      // hand is open
      else {
        // otherwise rotate continuously
        yaw = hand.yaw() * yawAngleFactor + autoAngleSpeedFactor;
        pitch = hand.pitch() * pitchAngleFactor + autoAngleSpeedFactor;
        roll = hand.roll() * rollAngleFactor + autoAngleSpeedFactor;
      }
    }

    return [yaw, pitch, roll];
}

function getHandsPositionsInWorldSpace(frame){

  const handsPosition = getHandsPositionFromFrame(frame);

  if (handsPosition === null){
    return null;
  }
  
  // this y conversion needs revision
  const iBox = frame.interactionBox;
  let normalizedPoint1 = iBox.normalizePoint(handsPosition[0], false);
  let normalizedPoint2 = iBox.normalizePoint(handsPosition[1], false);

  const heightHalf = canvas.clientHeight / 2;

  const spaceConvertedY1 = normalizedPoint1[1] * canvas.clientHeight - heightHalf;
  const spaceConvertedY2 = normalizedPoint2[1] * canvas.clientHeight - heightHalf;

  // push new vertices
  const hand1 = new THREE.Vector3(handsPosition[0][0], spaceConvertedY1, handsPosition[0][2]);
  const hand2 = new THREE.Vector3(handsPosition[1][0], spaceConvertedY2, handsPosition[1][2]);
  
  return [hand1, hand2];
}

function getManualYaw(hand){
	const velocityX = hand.palmVelocity[0];

  return Math.round(velocityX / dragVelocityThreshold * yawAngleFactor);
}

function getManualPitch(hand){
	const velocityY = hand.palmVelocity[1];

  return Math.round(velocityY / dragVelocityThreshold * pitchAngleFactor);
}

function extendedFingersCount(hand)
{
	let count = 0;
	hand.fingers.forEach(function(finger){
	    if (finger.extended) {
	    	count++;
	    };
	});
	return count;
}

// Rotate an object around an arbitrary axis in world space
function rotateAroundWorldAxis(delta, object, axis, radians) {
  let rotWorldMatrix = new THREE.Matrix4();

  const rotMult = delta * rollSpeed;

  rotWorldMatrix.makeRotationAxis(axis.normalize(), radians * rotMult);
  rotWorldMatrix.multiply(object.matrix); // pre-multiply
  object.matrix = rotWorldMatrix;
  object.rotation.setFromRotationMatrix(object.matrix);
}

function handleBasicInteraction(frame, object, delta){
  let rotationVector = frame ? getRotationFromFrame(frame) : null;

  // reset two hand interaction hand positions, 
  // so it doesn't "jump" when 2 hands are used again
  lastPositions = null;

  // keep last rotation when not interacting.
  // fallback to the default value of lastRotation (when leap hasn't been used yet)
  if (rotationVector === null) {
    rotationVector = lastRotation;
  } else {
    lastRotation = rotationVector;
  }

  // yaw
  if (rotationVector[0] !== 0) {
    // rotate around world's y axis
    rotateAroundWorldAxis(delta, object, new THREE.Vector3(0,1,0), rotationVector[0]);
  }

  // pitch
  if (rotationVector[1] !== 0) {
    // rotate around world's x axis
    rotateAroundWorldAxis(delta, object, new THREE.Vector3(1,0,0), rotationVector[1]);
  }

  // roll
  if (rotationVector[2] !== 0) {
    // rotate around world's z axis
    rotateAroundWorldAxis(delta, object, new THREE.Vector3(0,0,1), rotationVector[2]);
  }
}

function handleTwoHandInteraction(frame, object, delta){
  // Render arrow with direction between hands
  const handsPositions = getHandsPositionsInWorldSpace(frame);

  if (handsPositions ===  null){
    return;
  }
  
  if (lastPositions === null){
    lastPositions = handsPositions;
    return;
  }
  
  // Arrow helper
  /* let vDir = dir.subVectors(handsPositions[1], handsPositions[0]);

  //raycaster.set(handsPosition[0], vDir.normalize());
  //raycaster.far = vFar.subVectors(handsPosition[1], handsPosition[0]).length();

  arrow.position.copy(handsPositions[0]);
  arrow.setLength(vDir.length());
  arrow.setDirection(vDir.normalize()); */

  // one hand
  handsPositions[0].normalize();
  lastPositions[0].normalize();

  // 2nd hand
  handsPositions[1].normalize();
  lastPositions[1].normalize();

  // apply 1 hand rotation
  /* quaternion.setFromUnitVectors(lastPositions[0], handsPositions[0]);
  object.applyQuaternion(quaternion);

  // apply 2nd hand rotation
  quaternion.setFromUnitVectors(lastPositions[1], handsPositions[1]);
  object.applyQuaternion(quaternion); */

  finalHandQuatRotation.setFromUnitVectors(lastPositions[0], handsPositions[0]);
  hand2QuatRotation.setFromUnitVectors(lastPositions[1], handsPositions[1]);

  // composition of quaternions
  finalHandQuatRotation.multiply(hand2QuatRotation);
  object.applyQuaternion(finalHandQuatRotation);

  //update last position to have a term of comparison
  lastPositions = handsPositions;

  //update last euler rotation for fallback when no hands are present
  euler.setFromQuaternion(finalHandQuatRotation);
  lastRotation = new THREE.Vector3(euler.y, euler.x, euler.z);
  
}

function handleInteraction(delta, object){
  const frame = leapController ? leapController.frame() : null;

  if (frame === null) {
    return;
  }

  // for 1 hands or no hands
  if (frame.hands.length < 2){
    handleBasicInteraction(frame, object, delta);
    return;
  }

  // otherwise, handle 2 hands (or the first two :) )
  handleTwoHandInteraction(frame, object, delta);
}

function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}