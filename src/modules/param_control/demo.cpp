/****************************************************************************
 *
 *   Copyright (c) 2013-2019 PX4 Development Team. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name PX4 nor the names of its contributors may be
 *    used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHORS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 ****************************************************************************/

#include "demo.hpp"
#include <drivers/drv_hrt.h>
#include <lib/perf/perf_counter.h>
#include <px4_platform_common/events.h>

using namespace time_literals;

demo::demo(bool vtol) :
	ModuleParams(nullptr),
	WorkItem(MODULE_NAME, px4::wq_configurations::rate_ctrl),
	_loop_perf(perf_alloc(PC_ELAPSED, MODULE_NAME": cycle"))
{
	_time_stamp_last_loop = hrt_absolute_time();
}

demo::~demo()
{
	perf_free(_loop_perf);
}

bool demo::init()
{
	if (!_local_pos_sub.registerCallback()) {
		PX4_ERR("callback registration failed");
		return false;
	}

	// Resolve parameter handles once.
	_param_ifsc_dist_sw_handle = param_find("IFSC_DIST_SW");
	_param_demo_mode_handle    = param_find("DEMO_MODE");

	// Initial sync of _last_ifsc_dist_sw so we only react to *changes*.
	int32_t initial = 0;
	if (_param_ifsc_dist_sw_handle != PARAM_INVALID
	    && param_get(_param_ifsc_dist_sw_handle, &initial) == PX4_OK) {
		_last_ifsc_dist_sw = initial;
	}

	// Touch the placeholder tuning parameters so they are marked "used" and
	// therefore reported to QGroundControl over MAVLink PARAM_VALUE.
	static const char *kIfscTuningParams[] = {
		"IFSC_LQR_PARAM1",
		"IFSC_LQR_PARAM2",
		"IFSC_LQR_PARAM3",
		"IFSC_LQR_PARAM4",
		"IFSC_LQR_PARAM5",
		"IFSC_INDI_PARAM1",
		"IFSC_INDI_PARAM2",
		"IFSC_INDI_PARAM3",
		"IFSC_INDI_PARAM4",
		"IFSC_INDI_PARAM5",
	};

	for (const char *name : kIfscTuningParams) {
		param_find(name);
	}

	return true;
}

void demo::parameters_updated(bool forced)
{
	if (forced || _parameter_update_sub.updated()) {
		if (_parameter_update_sub.updated()) {
			parameter_update_s param_update;
			_parameter_update_sub.copy(&param_update);
			updateParams();
		}
	}
}

void demo::Run()
{
	if (should_exit()) {
		_local_pos_sub.unregisterCallback();
		exit_and_cleanup();
		return;
	}

	parameters_updated(false);

	perf_begin(_loop_perf);

	// IFSC-Station: detect changes to IFSC_DIST_SW and react.
	// Whenever the user flips the switch in QGroundControl we log the event here
	// on the vehicle side. Once the real parameter-based controller exists, this
	// switch should hand off to that controller instead of just printing.
	int32_t dist_sw = 0;
	if (_param_ifsc_dist_sw_handle != PARAM_INVALID
	    && param_get(_param_ifsc_dist_sw_handle, &dist_sw) == PX4_OK) {

		if (dist_sw != _last_ifsc_dist_sw) {
			switch (dist_sw) {
			case 3:
				PX4_INFO("[IFSC] Disturbance Switch -> MPC Control (3). MPC controller selected.");
				break;

			case 2:
				PX4_INFO("[IFSC] Disturbance Switch -> INDI Control (2). INDI controller selected.");
				break;

			case 1:
				PX4_INFO("[IFSC] Disturbance Switch -> LQR Control (1). LQR controller selected.");
				break;

			default:
				PX4_INFO("[IFSC] Disturbance Switch -> PID Control (0). Default built-in PID controller active.");
				break;
			}

			_last_ifsc_dist_sw = dist_sw;
		}
	}

	vehicle_local_position_s local_pos;

	if (_local_pos_sub.update(&local_pos)) {
		_time_stamp_last_loop = local_pos.timestamp_sample;

		// Keep the original tutorial behaviour so the demo remains useful.
		int32_t demo_mode = 1;
		if (_param_demo_mode_handle != PARAM_INVALID
		    && param_get(_param_demo_mode_handle, &demo_mode) != PX4_OK) {
			demo_mode = 1;
		}

		switch (demo_mode) {
		case 1:
			PX4_INFO("hello kk");

			if (local_pos.xy_valid) {
				PX4_INFO("Position: x=%.2f m, y=%.2f m, z=%.2f m",
					 (double)local_pos.x,
					 (double)local_pos.y,
					 (double)local_pos.z);
				PX4_INFO("Velocity: vx=%.2f m/s, vy=%.2f m/s, vz=%.2f m/s",
					 (double)local_pos.vx,
					 (double)local_pos.vy,
					 (double)local_pos.vz);
			}

			break;

		case 2:
			PX4_INFO("hello ds");
			break;

		default:
			break;
		}
	}

	perf_end(_loop_perf);
}

int demo::task_spawn(int argc, char *argv[])
{
	demo *instance = new demo();

	if (instance) {
		_object.store(instance);
		_task_id = task_id_is_work_queue;

		if (instance->init()) {
			return PX4_OK;
		}

	} else {
		PX4_ERR("alloc failed");
	}

	delete instance;
	_object.store(nullptr);
	_task_id = -1;

	return PX4_ERROR;
}

int demo::custom_command(int argc, char *argv[])
{
	return print_usage("unknown command");
}

int demo::print_usage(const char *reason)
{
	if (reason) {
		PX4_WARN("%s\n", reason);
	}

	PRINT_MODULE_DESCRIPTION(
		R"DESCR_STR(
### IFSC-Station placeholder

Exposes the IFSC_DIST_SW parameter to QGroundControl. The disturbance-switch
parameter selects between:

  * 0 - PID Control  (default, built-in PX4 PID controller)
  * 1 - Param Control (parameter-based controller; placeholder until the
         real IFSC-Station module is implemented)

The original param_control tutorial behaviour is retained for backwards compatibility.
)DESCR_STR");

	PRINT_MODULE_USAGE_NAME("param_control", "template");
	PRINT_MODULE_USAGE_COMMAND("start");
	PRINT_MODULE_USAGE_DEFAULT_COMMANDS();

	return 0;
}

extern "C" __EXPORT int param_control_main(int argc, char *argv[])
{
	return demo::main(argc, argv);
}