import { db } from './db';
import { MachineStation } from '../src/types';

export interface MachineExecutionResult {
  success: boolean;
  machineId: string;
  data: Record<string, any>;
  error?: string;
}

export class MachineGateway {
  // Simulate execution on a connected machine
  static async executeStep(
    machineId: string,
    stepName: string,
    inputParams: Record<string, any>
  ): Promise<MachineExecutionResult> {
    const machine = db.machines.get(machineId);
    if (!machine) {
      return { success: false, machineId, data: {}, error: `Machine ${machineId} not registered` };
    }

    if (machine.status === 'OFFLINE') {
      return {
        success: false,
        machineId,
        data: {},
        error: `Machine [${machine.name}] is currently OFFLINE. Use Manual Mode or reconnect machine in Maintenance settings.`,
      };
    }

    if (machine.status === 'MAINTENANCE') {
      return {
        success: false,
        machineId,
        data: {},
        error: `Machine [${machine.name}] is locked for calibration/maintenance.`,
      };
    }

    // Set BUSY briefly
    machine.status = 'BUSY';
    machine.lastPing = new Date().toISOString();

    // Machine-specific simulation logic
    let resultData: Record<string, any> = {};

    switch (machine.type) {
      case 'OCV_IR_TESTER': {
        // High-precision OCV & IR 4-wire Kelvin measurement
        const baseOcv = inputParams.baseOcv || 3.300;
        const baseIr = inputParams.baseIr || 0.250;
        const jitterOcv = (Math.random() - 0.5) * 0.0015;
        const jitterIr = (Math.random() - 0.5) * 0.008;

        const measuredOcv = Number((baseOcv + jitterOcv).toFixed(4));
        const measuredIr = Number((baseIr + jitterIr).toFixed(3));
        const measuredCap = Number((inputParams.supplierCapacity || 108.0 + (Math.random() - 0.5) * 0.1).toFixed(4));

        resultData = {
          measuredOcvV: measuredOcv,
          measuredIrMilliOhm: measuredIr,
          measuredCapacityAh: measuredCap,
          calculatedGrade: measuredIr < 0.30 && measuredOcv >= 3.28 ? 'Grade-A' : 'Grade-B',
          temperatureC: Number((23.4 + Math.random() * 1.2).toFixed(1)),
          probesContactResistanceOk: true,
          measurementTimestamp: new Date().toISOString(),
        };
        break;
      }

      case 'LASER_WELDER': {
        // CNC laser welding run (busbar to cell terminal tabs)
        const laserPower = 2800 + Math.floor(Math.random() * 80);
        const weldTime = 4100 + Math.floor(Math.random() * 150);
        const pullForce = Number((18.0 + Math.random() * 2.2).toFixed(1));
        const gasShieldOk = true;

        resultData = {
          laserPowerWatts: laserPower,
          weldTimeMs: weldTime,
          pullForceKg: pullForce,
          gasShieldFlowLpm: 15.2,
          opticalSeamTrackingOk: true,
          weldedSeamPoints: inputParams.cellCount ? inputParams.cellCount * 2 : 16,
          weldedAt: new Date().toISOString(),
        };
        break;
      }

      case 'BMS_TESTER': {
        // CAN bus interrogation, telemetry validation, NTC sensors
        const cellVoltages = Array.from({ length: inputParams.cellCount || 16 }, () => 
          Number((3.298 + (Math.random() - 0.5) * 0.004).toFixed(4))
        );
        const deltaMv = Number(((Math.max(...cellVoltages) - Math.min(...cellVoltages)) * 1000).toFixed(2));

        resultData = {
          canCommsOk: true,
          baudRate: '500 kbps',
          cellVoltages,
          deltaMv,
          ntcSensors: [24.1, 24.3, 24.0, 24.5],
          mosfetPrechargeOk: true,
          shortCircuitProtectionOk: true,
          firmwareHashVerified: true,
          testedAt: new Date().toISOString(),
        };
        break;
      }

      case 'FINAL_DYN_TESTER': {
        // 100A pulse discharge, high-pot insulation (500V DC)
        const packVoltage = Number((52.8 + (Math.random() - 0.5) * 0.15).toFixed(3));
        const totalIr = Number((0.41 + (Math.random() - 0.5) * 0.04).toFixed(3));
        const hiPot = Math.floor(500 + Math.random() * 80); // M-Ohms

        resultData = {
          packVoltageV: packVoltage,
          internalResistanceMilliOhm: totalIr,
          hiPotInsulationMOhm: hiPot,
          bmsTelemetryOk: true,
          maxDischargeCurrentA: 102.4,
          thermalSensorDeltaC: 0.5,
          enclosureGroundBondingOk: true,
          testedAt: new Date().toISOString(),
        };
        break;
      }
    }

    // Restore ONLINE
    machine.status = 'ONLINE';
    machine.totalRuns += 1;

    return {
      success: true,
      machineId,
      data: resultData,
    };
  }

  static toggleMachineStatus(machineId: string, status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE') {
    const m = db.machines.get(machineId);
    if (m) {
      m.status = status;
      m.lastPing = new Date().toISOString();
      return m;
    }
    return null;
  }
}
