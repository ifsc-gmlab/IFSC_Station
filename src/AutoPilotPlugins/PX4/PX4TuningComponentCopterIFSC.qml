/****************************************************************************
 *
 * (c) 2021 QGROUNDCONTROL PROJECT <http://www.qgroundcontrol.org>
 *
 * QGroundControl is licensed according to the terms in the file
 * COPYING.md in the root of the source code directory.
 *
 ****************************************************************************/

import QtQuick          2.3
import QtQuick.Controls 1.2
import QtQuick.Layouts  1.2

import QGroundControl               1.0
import QGroundControl.Controls      1.0
import QGroundControl.FactSystem    1.0
import QGroundControl.FactControls  1.0
import QGroundControl.ScreenTools   1.0

Item {
    width:  availableWidth
    anchors.fill: parent

    FactPanelController {
        id: controller
    }

    property Fact _distSw: controller.getParameterFact(-1, "IFSC_DIST_SW", false)

    property ListModel lqrParams: ListModel {
        ListElement {
            title:          qsTr("LQR Parameter 1")
            description:    qsTr("Placeholder tuning parameter 1 for the LQR controller.")
            param:          "IFSC_LQR_PARAM1"
            min:            0.0
            max:            10.0
            step:           0.1
        }
        ListElement {
            title:          qsTr("LQR Parameter 2")
            description:    qsTr("Placeholder tuning parameter 2 for the LQR controller.")
            param:          "IFSC_LQR_PARAM2"
            min:            0.0
            max:            10.0
            step:           0.1
        }
        ListElement {
            title:          qsTr("LQR Parameter 3")
            description:    qsTr("Placeholder tuning parameter 3 for the LQR controller.")
            param:          "IFSC_LQR_PARAM3"
            min:            0.0
            max:            10.0
            step:           0.1
        }
        ListElement {
            title:          qsTr("LQR Parameter 4")
            description:    qsTr("Placeholder tuning parameter 4 for the LQR controller.")
            param:          "IFSC_LQR_PARAM4"
            min:            0.0
            max:            10.0
            step:           0.1
        }
        ListElement {
            title:          qsTr("LQR Parameter 5")
            description:    qsTr("Placeholder tuning parameter 5 for the LQR controller.")
            param:          "IFSC_LQR_PARAM5"
            min:            0.0
            max:            10.0
            step:           0.1
        }
    }

    property ListModel indiParams: ListModel {
        ListElement {
            title:          qsTr("INDI Parameter 1")
            description:    qsTr("Placeholder tuning parameter 1 for the INDI controller.")
            param:          "IFSC_INDI_PARAM1"
            min:            0.0
            max:            10.0
            step:           0.1
        }
        ListElement {
            title:          qsTr("INDI Parameter 2")
            description:    qsTr("Placeholder tuning parameter 2 for the INDI controller.")
            param:          "IFSC_INDI_PARAM2"
            min:            0.0
            max:            10.0
            step:           0.1
        }
        ListElement {
            title:          qsTr("INDI Parameter 3")
            description:    qsTr("Placeholder tuning parameter 3 for the INDI controller.")
            param:          "IFSC_INDI_PARAM3"
            min:            0.0
            max:            10.0
            step:           0.1
        }
        ListElement {
            title:          qsTr("INDI Parameter 4")
            description:    qsTr("Placeholder tuning parameter 4 for the INDI controller.")
            param:          "IFSC_INDI_PARAM4"
            min:            0.0
            max:            10.0
            step:           0.1
        }
        ListElement {
            title:          qsTr("INDI Parameter 5")
            description:    qsTr("Placeholder tuning parameter 5 for the INDI controller.")
            param:          "IFSC_INDI_PARAM5"
            min:            0.0
            max:            10.0
            step:           0.1
        }
    }

    property ListModel mpcParams: ListModel {
        ListElement {
            title:          qsTr("Proportional gain (MPC_XY_P)")
            description:    qsTr("Increase for more responsiveness, reduce if the position overshoots.")
            param:          "MPC_XY_P"
            min:            0
            max:            2
            step:           0.05
        }
        ListElement {
            title:          qsTr("Proportional gain (MPC_Z_P)")
            description:    qsTr("Increase for more responsiveness, reduce if the position overshoots.")
            param:          "MPC_Z_P"
            min:            0
            max:            2
            step:           0.05
        }
        ListElement {
            title:          qsTr("Proportional gain (MPC_XY_VEL_P_ACC)")
            description:    qsTr("Increase for more responsiveness, reduce if the velocity overshoots.")
            param:          "MPC_XY_VEL_P_ACC"
            min:            1.2
            max:            5
            step:           0.05
        }
        ListElement {
            title:          qsTr("Integral gain (MPC_XY_VEL_I_ACC)")
            description:    qsTr("Increase to reduce steady-state error (e.g. wind).")
            param:          "MPC_XY_VEL_I_ACC"
            min:            0.2
            max:            10
            step:           0.2
        }
        ListElement {
            title:          qsTr("Differential gain (MPC_XY_VEL_D_ACC)")
            description:    qsTr("Damping: increase to reduce overshoots and oscillations.")
            param:          "MPC_XY_VEL_D_ACC"
            min:            0.1
            max:            2
            step:           0.05
        }
    }

    function logDistSw() {
        if (_distSw) {
            console.log("[IFSC] IFSC_DIST_SW = " + _distSw.enumIndex + " (" + _distSw.enumStringValue + ")")
        }
    }

    Connections {
        target: _distSw
        onValueChanged: logDistSw()
    }

    // Loggers: print a value whenever any tuning parameter changes.
    Repeater {
        model: lqrParams
        Item {
            property Fact _f: controller.getParameterFact(-1, param, false)
            Connections {
                target: _f
                onValueChanged: {
                    if (_f) console.log("[IFSC] LQR " + title + " (" + param + ") = " + _f.valueString)
                }
            }
        }
    }

    Repeater {
        model: indiParams
        Item {
            property Fact _f: controller.getParameterFact(-1, param, false)
            Connections {
                target: _f
                onValueChanged: {
                    if (_f) console.log("[IFSC] INDI " + title + " (" + param + ") = " + _f.valueString)
                }
            }
        }
    }

    Repeater {
        model: mpcParams
        Item {
            property Fact _f: controller.getParameterFact(-1, param, false)
            Connections {
                target: _f
                onValueChanged: {
                    if (_f) console.log("[IFSC] MPC " + title + " (" + param + ") = " + _f.valueString)
                }
            }
        }
    }

    QGCFlickable {
        id:             flick
        anchors.fill:   parent
        contentWidth:   width
        contentHeight:  contentColumn.height
        clip:           true

        Column {
            id:             contentColumn
            width:          flick.width
            spacing:        ScreenTools.defaultFontPixelHeight / 2

            QGCLabel {
                text:           qsTr("IFSC Disturbance Controller")
                font.family:    ScreenTools.demiboldFontFamily
            }

            GridLayout {
                columns: 2
                width:   parent.width

                QGCLabel {
                    text:       qsTr("Select Controller:")
                    visible:    _distSw
                }
                FactComboBox {
                    fact:       _distSw
                    indexModel: false
                    visible:    _distSw
                }
            }

            Column {
                width:   parent.width
                visible: _distSw && _distSw.enumIndex === 0

                QGCLabel {
                    text:       qsTr("The built-in PID controller is active. Use the Rate, Attitude, Velocity and Position tabs above to tune it.")
                    wrapMode:   Text.WordWrap
                    width:      parent.width
                }
            }

            Column {
                width:   parent.width
                visible: _distSw && _distSw.enumIndex === 1

                QGCLabel {
                    text:           qsTr("LQR Controller Parameters")
                    font.family:    ScreenTools.demiboldFontFamily
                }
                FactSliderPanel {
                    width:          parent.width
                    sliderModel:    lqrParams
                }
            }

            Column {
                width:   parent.width
                visible: _distSw && _distSw.enumIndex === 2

                QGCLabel {
                    text:           qsTr("INDI Controller Parameters")
                    font.family:    ScreenTools.demiboldFontFamily
                }
                FactSliderPanel {
                    width:          parent.width
                    sliderModel:    indiParams
                }
            }

            Column {
                width:   parent.width
                visible: _distSw && _distSw.enumIndex === 3

                QGCLabel {
                    text:           qsTr("MPC Controller Parameters")
                    font.family:    ScreenTools.demiboldFontFamily
                }
                FactSliderPanel {
                    width:          parent.width
                    sliderModel:    mpcParams
                }
            }
        }
    }
}
