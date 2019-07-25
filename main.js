import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader';

const plyModelPath = '/earthquakes-model/earthquakes.ply'

// how long it should wait after a throw before allowing image dragging after a throw
const dragBlockTimer = 0.8; 
// the minimum hand velocity to drag a image
const dragVelocityThreshold = 100;
// the minimum hand velocity to block dragging in one direction
// required to prevent inadvertent dragging as the hand returns to a particular position
const dragBlockVelocityThreshold = 500;

// angle adjustements when doing a fist
const rollAngleFactor = 20;
const pitchAngleFactor = 40;
const yawAngleFactor = 40;

// speed adjustment when hand is open
const autoAngleSpeedFactor = 100;

const directionEnum = {
	RIGHT: 'right',
	LEFT: 'left',
	UP: 'up',
	DOWN: 'down'
};

let lastDrag = null;
let leapInfo = null;
let isServerConnected = null;
let leapController = null;
let isLeapConnected = null;
let options = null;
// used to save last rotation and initial fallback value (when leap hasn't been used yet)
let lastRotation = [20, 30, 10];

let quaternion = new THREE.Quaternion();
let lastPositions = null;

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
        yaw += getManualYaw(hand);
        pitch += getManualPitch(hand);
      }
      // hand is open
      else {
        // otherwise rotate continuously
        yaw += hand.yaw() * yawAngleFactor + autoAngleSpeedFactor;
        pitch += hand.pitch() * pitchAngleFactor + autoAngleSpeedFactor;
        roll += hand.roll() * rollAngleFactor + autoAngleSpeedFactor;
      }
    }
  	// if there is at least another hand, we can handle drags when gestures are done is a certain speed
  	else if (frame.hands.length > 1 ){
      //const firstHand = frame.hands[0];
  		//const secondHand = frame.hands[1];

      
  		/* // make sure we don't repeat the heading control! (e.g., with 2 right hands)
  		if (firstHand.type === 'left' && secondHand.type === 'right'){
        pitch = getManualDragPitch(firstHand);
  			yaw = getManualDragYaw(secondHand);
  		}
  		// make sure we don't repeat the pitch control! (e.g., with 2 left hands)
  		else if (firstHand.type === 'right' && secondHand.type === 'left'){
        yaw = getManualDragYaw(firstHand);
  			pitch = getManualDragPitch(secondHand);
  		} */
  	}

    return [yaw, pitch, roll];
}

function getHandsPositionsInWorldSpace(frame){

  const handsPosition = getHandsPositionFromFrame(frame);

  if (handsPosition === null){
    return null;
  }
  
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

function getManualDragYaw(hand){
  const canRotateCW = canDoGesture(directionEnum.RIGHT);
	const canRotateCCW = canDoGesture(directionEnum.LEFT);

  const velocityX = getManualYaw(hand);

  if (canRotateCW && velocityX > dragVelocityThreshold){
    handleHighVelocity(directionEnum.RIGHT, velocityX);
    return velocityX;
	}
	else if (canRotateCCW && velocityX < -dragVelocityThreshold){
    handleHighVelocity(directionEnum.LEFT, velocityX);
    return velocityX;
  }

  return 0;
}

function getManualDragPitch(hand){
	const canRotateUp = canDoGesture(directionEnum.UP);
	const canRotateDown = canDoGesture(directionEnum.DOWN);

  const velocityY = getManualPitch(hand);

	if (canRotateUp && velocityY > dragVelocityThreshold){
    handleHighVelocity(directionEnum.UP, velocityY);
    return velocityY;
	}
	else if (canRotateDown && velocityY < -dragVelocityThreshold){
    handleHighVelocity(directionEnum.DOWN, velocityY);
    return velocityY;
  }

  return 0;
}

function canDoGesture(direction)
{
	var now = new Date(); 

	// if we are trying to move clockwise (right), 
	// we need to make sure the latest counter-clockwise (left) gesture 
	// didn't occur while in the timer interval and vice-versa
	// same deal with rotating up and down
	var mirror = mirrorDirection(direction);

	var diff = now.getTime() - mirror.getTime();

	var days = Math.floor(diff / (1000 * 60 * 60 * 24));
	diff -=  days * (1000 * 60 * 60 * 24);

	var hours = Math.floor(diff / (1000 * 60 * 60));
	diff -= hours * (1000 * 60 * 60);

	var mins = Math.floor(diff / (1000 * 60));
	diff -= mins * (1000 * 60);

	var seconds = Math.floor(diff / (1000));
	diff -= seconds * (1000);

	if (days > 0 || hours > 0 || mins > 0 || seconds > dragBlockTimer) {
		return true;
	}

	return false;
}

function handleHighVelocity(direction, velocity){
	if (velocity < -dragBlockVelocityThreshold || velocity > dragBlockVelocityThreshold){
		lastDrag[direction] = new Date();
	}
}

function mirrorDirection(rotationDirection){
	switch(rotationDirection){
		case directionEnum.RIGHT:
			return lastDrag.left;
		case directionEnum.LEFT:
			return lastDrag.right;
		case directionEnum.UP:
			return lastDrag.down;
		case directionEnum.DOWN:
			return lastDrag.up;
		default:
			throw new Error('invalid direction');
	}
}

function extendedFingersCount(hand)
{
	var count = 0;
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

  const rollSpeed = 0.005;
  const rotMult = delta * rollSpeed;

  rotWorldMatrix.makeRotationAxis(axis.normalize(), radians * rotMult);
  rotWorldMatrix.multiply(object.matrix); // pre-multiply
  object.matrix = rotWorldMatrix;
  object.rotation.setFromRotationMatrix(object.matrix);
}

//let vertArray = null;
//let lineGeometry = null;
//let dir = new THREE.Vector3();
//let vFar = new THREE.Vector3();
//let raycaster = new THREE.Raycaster();

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
  line.computeLineDistances(); */

  // arrow helper
  //var arrow = new THREE.ArrowHelper(raycaster.ray.direction, raycaster.ray.origin, 100, 0x00cc00 );
  //scene.add( arrow );

	//scene.add(line);

  // PLY file
  let loader = new PLYLoader();
  let group = new THREE.Object3D();

  loader.load(plyModelPath, function ( geometry ) {

    let material = new THREE.PointCloudMaterial({
      color: 0xffffff,
      size: 0.4,
      opacity: 0.8,
      transparent: true,
      blending: THREE.AdditiveBlending,
      map: generateSprite()
  });

    group = new THREE.PointCloud(geometry, material);
    group.sortParticles = true;
    group.rotateX(180);
    scene.add(group);

    prepareLeapMotion();

    lastDrag = {
      right: new Date(),
      left: new Date(),
      up: new Date(),
      down: new Date()
    };
  });

  function generateSprite() {
    var canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    var context = canvas.getContext('2d');
    var gradient = context.createRadialGradient(canvas.width / 2, canvas.height / 2, 0, canvas.width / 2, canvas.height / 2, canvas.width / 2);
    gradient.addColorStop(0, 'rgba(0,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(0,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(0,0,64,1)');
    gradient.addColorStop(1, 'rgba(0,0,0,1)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    var texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return texture;
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

  function handleBasicInteraction(frame, delta){
    let rotationVector = frame ? getRotationFromFrame(frame) : null;

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
      rotateAroundWorldAxis(delta, group, new THREE.Vector3(0,1,0), rotationVector[0]);
    }

    // pitch
    if (rotationVector[1] !== 0) {
      // rotate around world's x axis
      rotateAroundWorldAxis(delta, group, new THREE.Vector3(1,0,0), rotationVector[1]);
    }

    // roll
    if (rotationVector[2] !== 0) {
      // rotate around world's z axis
      rotateAroundWorldAxis(delta, group, new THREE.Vector3(0,0,1), rotationVector[2]);
    }
  }

  function handleTwoHandInteraction(frame, delta){
    // Render arrow with direction between hands
    const handsPositions = getHandsPositionsInWorldSpace(frame);

    if (handsPositions !==  null){
      if (lastPositions === null){
        lastPositions = handsPositions;
      }
      
      // Arrow helper
      /* 
      let vDir = dir.subVectors(handsPositions[1], handsPositions[0]);

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
      quaternion.setFromUnitVectors(lastPositions[0], handsPositions[0]);
      group.applyQuaternion(quaternion);

      // apply 2nd hand rotation
      quaternion.setFromUnitVectors(lastPositions[1], handsPositions[1]);
      group.applyQuaternion(quaternion);

      //update last position to have a term of comparison
      lastPositions = handsPositions;
    }
  }

  function handleInteraction(delta){
    const frame = leapController ? leapController.frame() : null;

    if (frame === null) {
      return;
    }

    // for 1 hands or no hands
    if (frame.hands.length < 2){
      handleBasicInteraction(frame, delta);
      return;
    }

    // otherwise, handle 2 hands (or the first two :) )
    handleTwoHandInteraction(frame, delta);
  }

  function render() {
    if (resizeRendererToDisplaySize(renderer)) {
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }

    handleInteraction(clock.getDelta());

    updateLeapInfo();
    
    renderer.render(scene, camera);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

main();
