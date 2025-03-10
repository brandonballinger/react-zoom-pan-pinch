import React, { Component } from "react";
import { initialState } from "./InitialState";
import {
  mergeProps,
  getDistance,
  handleCallback,
  handleWheelStop,
  additionalAnimationDelay,
} from "./utils";
import {
  handleZoomControls,
  handleDoubleClick,
  resetTransformations,
  handlePaddingAnimation,
  handleWheelZoom,
  handleCalculateBounds,
} from "./zoom";
import { handleDisableAnimation, animateComponent } from "./animations";
import { handleZoomPinch } from "./pinch";
import { handlePanning, handlePanningAnimation } from "./pan";
import {
  handleFireVelocity,
  animateVelocity,
  calculateVelocityStart,
} from "./velocity";
import makePassiveEventOption from "./makePassiveEventOption";
import {
  StateContextState,
  StateContextProps,
} from "./interfaces/stateContextInterface";
import { getValidPropsFromObject } from "./propsHandlers";

const Context = React.createContext({});

let wheelStopEventTimer = null;
const wheelStopEventTime = 180;
let wheelAnimationTimer = null;
const wheelAnimationTime = 180;

class StateProvider extends Component<StateContextProps, StateContextState> {
  public state = {
    wrapperComponent: undefined,
    contentComponent: undefined,
  };
  public stateProvider = {
    ...initialState,
    ...mergeProps(initialState, this.props.dynamicValues),
    ...this.props.defaultValues,
    previousScale:
      this.props.dynamicValues.scale ||
      this.props.defaultValues.scale ||
      initialState.scale,
  };

  // panning helpers
  public startCoords = null;
  public isDown = false;
  // pinch helpers
  public pinchStartDistance = null;
  public lastDistance = null;
  public pinchStartScale = null;
  public distance = null;
  public bounds = null;
  // velocity helpers
  public velocityTime = null;
  public lastMousePosition = null;
  public velocity = null;
  public offsetX = null;
  public offsetY = null;
  public throttle = false;
  // wheel helpers
  public previousWheelEvent = null;
  public lastScale = null;
  // animations helpers
  public animate = null;
  public animation = null;
  public maxBounds = null;

  componentDidMount() {
    const passiveOption = makePassiveEventOption(false);

    // Panning on window to allow panning when mouse is out of wrapper
    window.addEventListener(
      "mousedown",
      this.handleStartPanning,
      passiveOption,
    );
    window.addEventListener("mousemove", this.handlePanning, passiveOption);
    window.addEventListener("mouseup", this.handleStopPanning, passiveOption);
  }

  componentWillUnmount() {
    const passiveOption = makePassiveEventOption(false);

    window.removeEventListener(
      "mousedown",
      this.handleStartPanning,
      passiveOption,
    );
    window.removeEventListener("mousemove", this.handlePanning, passiveOption);
    window.removeEventListener(
      "mouseup",
      this.handleStopPanning,
      passiveOption,
    );
    handleDisableAnimation.call(this);
  }

  componentDidUpdate(oldProps, oldState) {
    const { wrapperComponent, contentComponent } = this.state;
    const { dynamicValues } = this.props;
    if (!oldState.contentComponent && contentComponent) {
      this.stateProvider.contentComponent = contentComponent;
    }
    if (
      !oldState.wrapperComponent &&
      wrapperComponent &&
      wrapperComponent !== undefined
    ) {
      this.stateProvider.wrapperComponent = wrapperComponent;

      // Zooming events on wrapper
      const passiveOption = makePassiveEventOption(false);
      wrapperComponent.addEventListener(
        "wheel",
        this.handleWheel,
        passiveOption,
      );
      wrapperComponent.addEventListener(
        "dblclick",
        this.handleDbClick,
        passiveOption,
      );
      wrapperComponent.addEventListener(
        "touchstart",
        this.handleTouchStart,
        passiveOption,
      );
      wrapperComponent.addEventListener(
        "touchmove",
        this.handleTouch,
        passiveOption,
      );
      wrapperComponent.addEventListener(
        "touchend",
        this.handleTouchStop,
        passiveOption,
      );
    }

    // set bound for animations
    if (
      (wrapperComponent && contentComponent) ||
      oldProps.dynamicValues !== dynamicValues
    ) {
      this.maxBounds = handleCalculateBounds.call(
        this,
        this.stateProvider.scale,
        this.stateProvider.pan.limitToWrapperBounds,
      );
    }

    // must be at the end of the update function, updates
    if (oldProps.dynamicValues && oldProps.dynamicValues !== dynamicValues) {
      this.animation = null;
      this.stateProvider = {
        ...this.stateProvider,
        ...mergeProps(this.stateProvider, dynamicValues),
      };
      this.setContentComponentTransformation(null, null, null);
    }
  }

  //////////
  // Wheel
  //////////

  handleWheel = event => {
    const {
      scale,
      wheel: { disabled, wheelEnabled, touchPadEnabled },
    } = this.stateProvider;

    const { onWheelStart, onWheel, onWheelStop, onZoomChange } = this.props;
    const { wrapperComponent, contentComponent } = this.state;

    if (
      this.isDown ||
      disabled ||
      this.stateProvider.options.disabled ||
      !wrapperComponent ||
      !contentComponent
    )
      return;

    // ctrlKey detects if touchpad execute wheel or pinch gesture
    if (!wheelEnabled && !event.ctrlKey) return;
    if (!touchPadEnabled && event.ctrlKey) return;

    // Wheel start event
    if (!wheelStopEventTimer) {
      this.lastScale = scale;
      handleDisableAnimation.call(this);
      handleCallback(onWheelStart, this.getCallbackProps());
    }

    // Wheel event
    handleWheelZoom.call(this, event);
    handleCallback(onWheel, this.getCallbackProps());
    this.setContentComponentTransformation(null, null, null);
    this.previousWheelEvent = event;

    // Wheel stop event
    if (handleWheelStop(this.previousWheelEvent, event, this.stateProvider)) {
      clearTimeout(wheelStopEventTimer);
      wheelStopEventTimer = setTimeout(() => {
        handleCallback(onWheelStop, this.getCallbackProps());
        handleCallback(onZoomChange, this.getCallbackProps());
        wheelStopEventTimer = null;
      }, wheelStopEventTime);
    }

    // cancel animation
    this.animate = false;

    // fire animation
    if (this.lastScale !== this.stateProvider.scale) {
      this.lastScale = this.stateProvider.scale;
      clearTimeout(wheelAnimationTimer);
      wheelAnimationTimer = setTimeout(() => {
        handlePaddingAnimation.call(this, event);
      }, wheelAnimationTime);
    }
  };

  //////////
  // Panning
  //////////

  checkPanningTarget = event => {
    const {
      pan: { disableOnTarget },
    } = this.stateProvider;

    return (
      disableOnTarget
        .map(tag => tag.toUpperCase())
        .includes(event.target.tagName) ||
      disableOnTarget.find(element =>
        event.target.classList.value.includes(element),
      )
    );
  };

  checkIsPanningActive = event => {
    const {
      pan: { disabled },
    } = this.stateProvider;
    const { wrapperComponent, contentComponent } = this.state;

    return (
      !this.isDown ||
      disabled ||
      this.stateProvider.options.disabled ||
      (event.touches &&
        (event.touches.length !== 1 ||
          Math.abs(this.startCoords.x - event.touches[0].clientX) < 1)) ||
      !wrapperComponent ||
      !contentComponent
    );
  };

  handleSetUpPanning = (x, y) => {
    const { positionX, positionY } = this.stateProvider;
    this.isDown = true;
    this.startCoords = { x: x - positionX, y: y - positionY };

    handleCallback(this.props.onPanningStart, this.getCallbackProps());
  };

  handleStartPanning = event => {
    const {
      wrapperComponent,
      scale,
      options: { minScale },
      pan: { disabled, limitToWrapperBounds },
    } = this.stateProvider;
    const { target, touches } = event;

    if (
      disabled ||
      this.stateProvider.options.disabled ||
      (wrapperComponent && !wrapperComponent.contains(target)) ||
      scale < minScale ||
      this.checkPanningTarget(event)
    )
      return;

    handleDisableAnimation.call(this);
    this.bounds = handleCalculateBounds.call(this, scale, limitToWrapperBounds);

    // Mobile points
    if (touches && touches.length === 1) {
      this.handleSetUpPanning(touches[0].clientX, touches[0].clientY);
    }
    // Desktop points
    if (!touches) {
      this.handleSetUpPanning(event.clientX, event.clientY);
    }
  };

  handlePanning = event => {
    if (this.isDown) event.preventDefault();
    if (this.checkIsPanningActive(event)) return;
    event.stopPropagation();
    calculateVelocityStart.call(this, event);
    handlePanning.call(this, event);
    handleCallback(this.props.onPanning, this.getCallbackProps());
  };

  handleStopPanning = () => {
    if (this.isDown) {
      this.isDown = false;
      handleFireVelocity.call(this);
      handleCallback(this.props.onPanningStop, this.getCallbackProps());

      const {
        positionX,
        positionY,
        pan: { panPaddingShiftTime, velocity },
      } = this.stateProvider;
      const {
        minPositionX,
        minPositionY,
        maxPositionX,
        maxPositionY,
      } = this.bounds;

      const isInsideBounds =
        positionX > minPositionX &&
        positionY > minPositionY &&
        positionX < maxPositionX &&
        positionY < maxPositionY;

      // start velocity animation
      if (this.velocity && velocity && isInsideBounds) {
        animateVelocity.call(this);
      } else {
        setTimeout(() => {
          // fire fit to bounds animation
          handlePanningAnimation.call(this);
        }, panPaddingShiftTime + additionalAnimationDelay);
      }
    }
  };

  //////////
  // Pinch
  //////////

  handlePinchStart = event => {
    const { scale } = this.stateProvider;
    event.preventDefault();
    event.stopPropagation();

    handleDisableAnimation.call(this);
    const distance = getDistance(event.touches[0], event.touches[1]);
    this.pinchStartDistance = distance;
    this.lastDistance = distance;
    this.pinchStartScale = scale;

    handleCallback(this.props.onPinchingStart, this.getCallbackProps());
  };

  handlePinch = event => {
    handleZoomPinch.call(this, event);
    handleCallback(this.props.onPinching, this.getCallbackProps());
  };

  handlePinchStop = () => {
    if (typeof this.pinchStartScale === "number") {
      this.pinchStartDistance = null;
      this.lastDistance = null;
      this.pinchStartScale = null;
      handlePaddingAnimation.call(this);
      handleCallback(this.props.onPinchingStop, this.getCallbackProps());
    }
  };

  //////////
  // Touch Events
  //////////

  handleTouchStart = event => {
    const {
      wrapperComponent,
      contentComponent,
      scale,
      options: { disabled, minScale },
    } = this.stateProvider;
    const { touches } = event;
    if (disabled || !wrapperComponent || !contentComponent || scale < minScale)
      return;
    handleDisableAnimation.call(this);

    if (touches && touches.length === 1) return this.handleStartPanning(event);
    if (touches && touches.length === 2) return this.handlePinchStart(event);
  };

  handleTouch = event => {
    const { pan, pinch, options } = this.stateProvider;
    if (options.disabled) return;
    if (!pan.disabled && event.touches.length === 1)
      return this.handlePanning(event);
    if (!pinch.disabled && event.touches.length === 2)
      return this.handlePinch(event);
  };

  handleTouchStop = () => {
    this.handlePinchStop();
    this.handleStopPanning();
  };

  //////////
  // Controls
  //////////

  zoomIn = event => {
    const {
      zoomIn: { disabled, step },
      options,
    } = this.stateProvider;
    const { wrapperComponent, contentComponent } = this.state;

    if (!event) throw Error("Zoom in function requires event prop");
    if (disabled || options.disabled || !wrapperComponent || !contentComponent)
      return;
    handleZoomControls.call(this, 1, step);
  };

  zoomOut = event => {
    const {
      zoomOut: { disabled, step },
      options,
    } = this.stateProvider;
    const { wrapperComponent, contentComponent } = this.state;

    if (!event) throw Error("Zoom out function requires event prop");
    if (disabled || options.disabled || !wrapperComponent || !contentComponent)
      return;
    handleZoomControls.call(this, -1, step);
  };

  handleDbClick = event => {
    const {
      options,
      doubleClick: { disabled, step },
    } = this.stateProvider;
    const { wrapperComponent, contentComponent } = this.state;

    if (!event) throw Error("Double click function requires event prop");
    if (disabled || options.disabled || !wrapperComponent || !contentComponent)
      return;
    handleDoubleClick.call(this, event, 1, step);
  };

  setScale = (newScale, speed = 200, type = "easeOut") => {
    const {
      positionX,
      positionY,
      scale,
      options: { disabled },
    } = this.stateProvider;
    const { wrapperComponent, contentComponent } = this.state;
    if (disabled || !wrapperComponent || !contentComponent) return;
    const targetState = {
      positionX,
      positionY,
      scale: isNaN(newScale) ? scale : newScale,
    };

    animateComponent.call(this, {
      targetState,
      speed,
      type,
    });
  };

  setPositionX = (newPosX, speed = 200, type = "easeOut") => {
    const {
      positionX,
      positionY,
      scale,
      options: { disabled, transformEnabled },
    } = this.stateProvider;
    const { wrapperComponent, contentComponent } = this.state;
    if (disabled || !transformEnabled || !wrapperComponent || !contentComponent)
      return;
    const targetState = {
      positionX: isNaN(newPosX) ? positionX : newPosX,
      positionY,
      scale,
    };

    animateComponent.call(this, {
      targetState,
      speed,
      type,
    });
  };

  setPositionY = (newPosY, speed = 200, type = "easeOut") => {
    const {
      positionX,
      scale,
      positionY,
      options: { disabled, transformEnabled },
    } = this.stateProvider;
    const { wrapperComponent, contentComponent } = this.state;
    if (disabled || !transformEnabled || !wrapperComponent || !contentComponent)
      return;

    const targetState = {
      positionX,
      positionY: isNaN(newPosY) ? positionY : newPosY,
      scale,
    };

    animateComponent.call(this, {
      targetState,
      speed,
      type,
    });
  };

  setTransform = (
    newPosX,
    newPosY,
    newScale,
    speed = 200,
    type = "easeOut",
  ) => {
    const {
      positionX,
      positionY,
      scale,
      options: { disabled, transformEnabled },
    } = this.stateProvider;
    const { wrapperComponent, contentComponent } = this.state;
    if (disabled || !transformEnabled || !wrapperComponent || !contentComponent)
      return;

    const targetState = {
      positionX: isNaN(newPosX) ? positionX : newPosX,
      positionY: isNaN(newPosY) ? positionY : newPosY,
      scale: isNaN(newScale) ? scale : newScale,
    };

    animateComponent.call(this, {
      targetState,
      speed,
      type,
    });
  };

  resetTransform = () => {
    const {
      options: { disabled, transformEnabled },
    } = this.stateProvider;
    if (disabled || !transformEnabled) return;
    resetTransformations.call(this);
  };

  setDefaultState = () => {
    this.animation = null;
    this.stateProvider = {
      ...this.stateProvider,
      scale: initialState.scale,
      positionX: initialState.positionX,
      positionY: initialState.positionY,
      ...this.props.defaultValues,
    };
    this.forceUpdate();
  };

  //////////
  // Setters
  //////////

  setWrapperComponent = wrapperComponent => {
    this.setState({ wrapperComponent });
  };

  setContentComponent = contentComponent => {
    this.setState({ contentComponent }, () => {
      if (this.stateProvider.options.centerContent) {
        const { scale } = this.stateProvider;
        const rect = this.state.wrapperComponent.getBoundingClientRect();
        this.stateProvider.positionX = (rect.width - rect.width * scale) / 2;
        this.stateProvider.positionY = (rect.height - rect.height * scale) / 2;
      }
      this.setContentComponentTransformation(null, null, null);
    });
  };

  setContentComponentTransformation = (scale, posX, posY) => {
    const { contentComponent } = this.state;
    if (!contentComponent)
      return console.error("There is no content component");
    const transform = `translate(${posX ||
      this.stateProvider.positionX}px, $0px) scaleX(${scale ||
      this.stateProvider.scale})`;
    contentComponent.style.transform = transform;
    contentComponent.style.WebkitTransform = transform;
    // force update to inject state to the context
    this.forceUpdate();
  };

  //////////
  // Props
  //////////

  getCallbackProps = () => getValidPropsFromObject(this.stateProvider);

  render() {
    /**
     * Context provider value
     */
    const value = {
      state: this.getCallbackProps(),
      dispatch: {
        setScale: this.setScale,
        setPositionX: this.setPositionX,
        setPositionY: this.setPositionY,
        zoomIn: this.zoomIn,
        zoomOut: this.zoomOut,
        setTransform: this.setTransform,
        resetTransform: this.resetTransform,
        setDefaultState: this.setDefaultState,
      },
      nodes: {
        setWrapperComponent: this.setWrapperComponent,
        setContentComponent: this.setContentComponent,
      },
    };
    const { children } = this.props;
    const content =
      typeof children === "function"
        ? children({ ...value.state, ...value.dispatch })
        : children;

    return <Context.Provider value={value}>{content}</Context.Provider>;
  }
}

export { Context, StateProvider };
