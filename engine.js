window.onload = () => {

  // Instantiate audio context that is needed to define AudioObject class.
  let audioCtx = new AudioContext();

  // How often the engine updates.
  const UPDATE_PERIOD_MS = 50;

  // Set up global filter for "focus mode."
  let globalFilter = audioCtx.createBiquadFilter();
  globalFilter.type = "lowpass";
  globalFilter.frequency.setValueAtTime(20000, audioCtx.currentTime);
  globalFilter.connect(audioCtx.destination);

  // Variable to track if cursor is outside of the browser window.
  this.hasGoneOut = false;
  this.userPaused = true;

  class AudioObject {

    constructor(name, filePath, x, y) {

      // "Hack" to build asynchronous constructor. See the second answer here:
      //    https://stackoverflow.com/questions/43431550/async-await-class-constructor

      return (async () => {
        // Build DSP elements of audio object.
        this.dryGain = audioCtx.createGain();
        this.wetGain = audioCtx.createGain();
        this.source = await this.createSource(filePath);
        this.panner = audioCtx.createStereoPanner();
        this.reverb = await this.createReverb();
        this.filter = this.createHighShelf();

        // Connect the elements. 
        // Note the two paths: dry and wet (reverb).
        this.source.connect(this.dryGain);

        this.source.connect(this.reverb);
        this.reverb.connect(this.wetGain);

        this.dryGain.connect(this.filter);
        this.wetGain.connect(this.filter);

        this.filter.connect(this.panner);
        this.panner.connect(globalFilter);

        // Accept a nickname.
        this.name = name;

        // Accept X/Y location.
        this.x = x;
        this.y = y;

        this.isPlaying = false;

        return this;
      })()
    }

    // Interface.
    play() {
      this.source.start();
      this.isPlaying = true;
    };

    stop() {
      this.source.stop();
    };

    updateFromMousePosition(mouseX, mouseY, theta) {

      // Apply rotation.
      let tmpDeltaX = this.x - mouseX;
      let tmpDeltaY = this.y - mouseY;

      let rotateX = Math.cos(theta) * tmpDeltaX - Math.sin(theta) * tmpDeltaY + mouseX;
      let rotateY = Math.sin(theta) * tmpDeltaX + Math.cos(theta) * tmpDeltaY + mouseY;

      let deltaX = rotateX - mouseX;
      let deltaY = rotateY - mouseY;

      let magnitude = Math.sqrt(Math.pow(deltaX, 2) + Math.pow(deltaY, 2));
      magnitude /= Math.sqrt(2);  // Normalize to [0, 1] range.

      this.setPan(deltaX);
      this.setDepth(deltaY);
      this.setDistance(magnitude);
    };

    // Methods that used to be "Private"
    async createSource(filePath) {
      let response = await fetch(filePath);
      let audioData = await response.arrayBuffer();
      let audioBuffer = await audioCtx.decodeAudioData(audioData);
      let audioSource = audioCtx.createBufferSource();

      audioSource.buffer = audioBuffer;
      audioSource.loop = true;

      return audioSource;
    };

    async createReverb() {
      const VERB_IR_PATH = "audio/St Nicolaes Church_WET.wav";

      let convolver = audioCtx.createConvolver();
      let response = await fetch(VERB_IR_PATH);
      let audioData = await response.arrayBuffer();

      convolver.buffer = await audioCtx.decodeAudioData(audioData);
      return convolver;
    };

    createHighShelf() {
      const F0_HZ = 1000;
      const DEFAULT_Q = 0.707;

      let filter = audioCtx.createBiquadFilter();

      filter.type = "highshelf";
      filter.frequency.linearRampToValueAtTime(F0_HZ, audioCtx.currentTime + 0.001);
      filter.Q.linearRampToValueAtTime(DEFAULT_Q, audioCtx.currentTime + 0.001);
      filter.gain.linearRampToValueAtTime(-36, audioCtx.currentTime + 0.001);

      return filter;
    }

    setPan(val) {
      this.panner.pan.linearRampToValueAtTime(val, audioCtx.currentTime + 0.001);
      // console.log(`Panning ${this.name} to value ${val}.`);
    }

    setDepth(val) {
      const FILT_LIMIT_DB = 36;
      let distanceBehindCursor = Math.max(val, 0);

      // Mute high frequencies to simulate sound coming from behind user.
      let tmp =  - distanceBehindCursor * FILT_LIMIT_DB;
      this.filter.gain.linearRampToValueAtTime(tmp, audioCtx.currentTime + 0.001);
    }

    setDistance(distanceFromCursor) {
      // Attenuate gain based on distance from cursor.

      const DRY_GAIN_DB = -6;
      const DRY_GAIN_REDUCE_DB = 30;
      const WET_GAIN_REDUCE_DB = 24;

      let tmp = 0;

      // Calculate in dB then covert to linear.
      tmp = DRY_GAIN_DB - distanceFromCursor * DRY_GAIN_REDUCE_DB;
      tmp = Math.pow(10, tmp / 20);

      this.dryGain.gain.linearRampToValueAtTime(tmp, audioCtx.currentTime + 0.001);

      tmp = - distanceFromCursor * WET_GAIN_REDUCE_DB;
      tmp = Math.pow(10, tmp / 20);

      this.wetGain.gain.linearRampToValueAtTime(tmp, audioCtx.currentTime + 0.001);

    }
  }

  // GUI.
  let engineStatusGui = document.createElement("span");
  engineStatusGui.style = "cursor: pointer; position: absolute; bottom: 10px";

  engineStatusGui.addEventListener("click", () => {

    if (localStorage.getItem("isEngineOn") === 'true') {
      stopEngine();
      this.userPaused = true;
    } else {
      startEngine();
      this.userPaused = false;
    }

    updateEngineStatusGui();
  })

  async function stopEngine() {
    localStorage.setItem("isEngineOn", false);

    // Stop all playing sounds.
    for (let audioObject of audioObjectList)
      audioObject.stop();

    const NUM_BUTTONS = 2;
    BUTTON_CLASSES = ["button1", "button2"];
    for (let i = 0; i < NUM_BUTTONS; ++i) {
      let className = BUTTON_CLASSES[i];

      // Find object.
      let buttonElement = document.getElementsByClassName(className);
      buttonElement = buttonElement[0];

      // Remove event listeners.
      buttonElement.removeEventListener("mouseenter", turnOnFocusMode);
      buttonElement.removeEventListener("mouseleave", turnOffFocusMode);  
    }
  };

  document.body.appendChild(engineStatusGui);

  if (typeof localStorage.getItem("isEngineOn") == "undefined" || localStorage.getItem("isEngineOn") === 'true')
    startEngine();

  updateEngineStatusGui();

  let audioObjectList = [];
  let dingSource;
  let tictocSource;

  function updateEngineStatusGui() {
    if (localStorage.getItem("isEngineOn") === 'true') {
      engineStatusGui.innerHTML = "⏸ Pause engine";
      engineStatusGui.className = "animate-flicker";
    } else {
      engineStatusGui.innerHTML = "▶️ Start engine";
      engineStatusGui.className = [];
    }
  }

  async function turnOnFocusMode() {
    globalFilter.frequency.linearRampToValueAtTime(500, audioCtx.currentTime + 0.1);
    globalFilter.Q.linearRampToValueAtTime(10, audioCtx.currentTime + 0.1);

    // Change playback rate to non-zero value.
    // 
    // This is rather than "start," which can spawn spurious tic-toc playbacks.
    tictocSource.playbackRate.value = 5.0; 
  };

  async function turnOffFocusMode() {
    globalFilter.frequency.linearRampToValueAtTime(20000, audioCtx.currentTime + 0.1);
    globalFilter.Q.linearRampToValueAtTime(0.707, audioCtx.currentTime + 0.1);

    // "Stop" by setting playback rate to 0.
    tictocSource.playbackRate.value = 0.0;
  };

  async function startEngine() {

    localStorage.setItem("isEngineOn", true);

    // The following connects the button locations to sounds and objects.
    // Eventually this will be taken care of by an intermediate module.

    const NUM_BUTTONS = 2;
    //const FILE_PATHS = ['audio/solemn.mp3', 'audio/demonstrative.mp3'];
    const FILE_PATHS = ['audio/footsteps.wav', 'audio/heels.wav'];
    const BUTTON_CLASSES = ['button1', 'button2'];

    dingSource = await (async () => {
      const TIC_TOC_PATH = "audio/ding.wav";
      let response = await fetch(TIC_TOC_PATH);
      let audioData = await response.arrayBuffer();
      let audioBuffer = await audioCtx.decodeAudioData(audioData);
      let source = audioCtx.createBufferSource();
  
      source.buffer = audioBuffer;
  
      return source;
    })()

    dingSource.connect(audioCtx.destination);
    dingSource.start();

    tictocSource = await (async () => {
      const TIC_TOC_PATH = "audio/tictoc.wav";
      let response = await fetch(TIC_TOC_PATH);
      let audioData = await response.arrayBuffer();
      let audioBuffer = await audioCtx.decodeAudioData(audioData);
      let source = audioCtx.createBufferSource();

      source.buffer = audioBuffer;
      source.loop = true;

      return source;
    })()

    // Set initial rate to 0 (no playback).
    tictocSource.playbackRate.value = 0.0;
    tictocSource.connect(audioCtx.destination);
    tictocSource.start()

    for (let i = 0; i < NUM_BUTTONS; ++i) {
      let className = BUTTON_CLASSES[i];
      let filePath = FILE_PATHS[i];

      // Find object.
      let buttonElement = document.getElementsByClassName(className);
      buttonElement = buttonElement[0];

      buttonElement.addEventListener("mouseenter", turnOnFocusMode);
      buttonElement.addEventListener("mouseleave", turnOffFocusMode);

      let [x, y] = getButtonXY(buttonElement);

      let tmp = await new AudioObject(className, filePath, x, y);

      audioObjectList.push(tmp);

    }
  }

  // Return button normalized X, Y as identified by class name.
  function getButtonXY(buttonElement) {

    let rect = buttonElement.getBoundingClientRect();

    // Find center of object.
    let x = rect.x + (rect.width / 2);
    let y = rect.y + (rect.height / 2);

    // Find window size.
    let width = window.innerWidth;
    let height = window.innerHeight;

    // Normalize positions to window size.
    let normX = x / width;
    let normY = y / height;

    return [normX, normY];
  }

  // Update mouse X and Y position on mouse move.
  let normX = 0;
  let normY = 0;
  document.onmousemove = (e) => {

    let width = window.innerWidth;
    let height = window.innerHeight;

    normX = e.clientX / width;
    normY = e.clientY / height;

  };

  // Variables for smoothed mouse history.
  let memX = 0;
  let memY = 0;

  // Update engine based on mouse.
  setInterval( () => {

    // How smoothly does the head turn back to fwd position.
    const SMOOTH_COEF = 0.9;

    // Calculate smoothed, delayed versions of x and y mouse positions.
    memX = SMOOTH_COEF * memX + (1 - SMOOTH_COEF) * normX;

    // Calculate angle between current mouse and delayed mouse.
    let deltaX = normX - memX;

    // Y is a fixed position "in front of the head" of the cursor.
    //
    // Smaller values of Y make the head "jerk" more sudden.
    let deltaY = 1;

    const EPS = 1e-5;
    let theta = Math.atan(deltaX/ deltaY);

    // Debugging.
    // console.log(`theta: ${theta.toFixed(4)}`);
  
    for (let audioObject of audioObjectList) {
      audioObject.updateFromMousePosition(normX, normY, theta);

      if (!audioObject.isPlaying)
        audioObject.play();
    }

  }, UPDATE_PERIOD_MS);

  // Reset object positions based on new window size.
  window.addEventListener('resize', () => {
    for (let audioObject of audioObjectList) {

      let className = audioObject.name;

      let buttonElement = document.getElementsByClassName(className);
      buttonElement = buttonElement[0];
      
      let [x, y] = getButtonXY(buttonElement);

      audioObject.x = x;
      audioObject.y = y;
    }
  })

  // Stop sounds if mouse leaves the screen
  document.addEventListener("mouseleave", (event) => {
    if (this.hasGoneOut == false && event.clientY <= 0 || event.clientX <= 0 || (event.clientX >= window.innerWidth || event.clientY >= window.innerHeight)) {  
      this.hasGoneOut = true;
      if (this.userPaused == false) {
        stopEngine();
        updateEngineStatusGui();
      }
    } 
  });

  // Play sounds if mouse comes back to screen
  document.addEventListener("mouseenter", (event) => {
    if (this.hasGoneOut == true && event.clientY > 0 && event.clientX > 0 && (event.clientX < window.innerWidth && event.clientY < window.innerHeight)) {
      this.hasGoneOut = false;
      if (this.userPaused == false) {
        startEngine();
        updateEngineStatusGui();
      }
    } 
  });

}