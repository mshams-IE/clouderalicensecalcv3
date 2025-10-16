import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// TYPES
enum Category {
  BASE = 'BASE',
  STREAMING = 'STREAMING',
  ECS = 'ECS',
  ML = 'ML',
  DATASERVICES = 'DATASERVICES',
  DATAFLOW = 'DATAFLOW',
  SPECIAL = 'SPECIAL',
}

type DisplayCategory = 'CDP Base' | 'Data-in-Motion' | 'Data Services';
type DisplaySubCategory = 'CDP Streaming' | 'DataFlow (NiFi)';
type SupportLevel = 'Standard' | 'Business' | 'Business Select';
type CemPackSize = '100' | '500' | '1k' | '5k' | '10k' | '30k' | '50k' | '100k';

interface NodeSpec {
  id: string;
  name: string;
  category: Category;
  displayCategory: DisplayCategory;
  displaySubCategory?: DisplaySubCategory;
  vCPU: number;
  memory: number;
  storage: number;
  gpuConfigurable?: boolean;
}

interface EnvironmentData {
  id: string;
  name: string;
  nodes: NodeSpec[];
  defaultCounts: { [nodeId: string]: number };
  defaultGpu: string; 
  type: 'prod' | 'preprod';
}

interface NodeDisk {
  id: string;
  type: 'ssd' | 'hdd' | 'nvme';
  quantity: number;
  size: number;
  unit: 'GB' | 'TB';
}

interface EnvironmentNode {
  id: string;
  name: string;
  category: Category;
  displayCategory: DisplayCategory;
  displaySubCategory?: DisplaySubCategory;
  gpuConfigurable?: boolean;
  count: number;
  order: number;
  cpuType: 'physical' | 'virtual';
  disks: NodeDisk[];
  vCPU: number;
  memory: number;
  gpuModel?: string;
  gpuQuantity?: number;
}

interface AppState {
  [envId: string]: {
    nodes: EnvironmentNode[];
    caiUserPack: 0 | 5 | 10 | 100 | 500;
    caiAdminPacks: number;
    cemPacks: { [key in CemPackSize]?: number };
    monitoredEnvIds?: string[];
  }
}

interface SessionAppState {
    supportLevel: SupportLevel;
    environments: EnvironmentData[];
    environmentsState: AppState;
    activeTab: string;
}

interface Session {
    id: string;
    name: string;
    createdAt: string;
    lastModified: string;
    appState: SessionAppState;
}

interface Workspace {
    activeSessionId: string | null;
    sessions: Session[];
}

interface LicenseCategoryTotal {
  vCPU: number;
  memory: number;
  storage: number;
  nodeCount: number;
}

interface LicenseTotalsByCategory {
  [Category.BASE]: LicenseCategoryTotal;
  [Category.STREAMING]: LicenseCategoryTotal;
  [Category.ECS]: LicenseCategoryTotal;
  [Category.ML]: LicenseCategoryTotal;
  [Category.DATASERVICES]: LicenseCategoryTotal;
  [Category.DATAFLOW]: LicenseCategoryTotal;
  [Category.SPECIAL]: { nodes: { [nodeId: string]: number } };
}


interface DisplayTotals {
    cdpBase: { vCPU: number; memory: number; storage: number; nodeCount: number };
    cdpStreaming: { vCPU: number; memory: number; storage: number; nodeCount: number };
    dataflow: { vCPU: number; memory: number; storage: number };
    dataServices: {
        master_vCPU: number;
        master_memory: number;
        master_storage: number;
        worker_vCPU: number;
        worker_memory: number;
        worker_storage: number;
        totalGpu: number;
    };
}

interface CalculatedLicenses {
  sku: string;
  description: string;
  quantity: number;
}

interface CategorizedLicense extends CalculatedLicenses {
  displayCategory: DisplayCategory;
  displaySubCategory?: DisplaySubCategory;
}


// CONSTANTS & DATA
const GPU_MODELS = [
  'NVIDIA M60', 'NVIDIA P4', 'NVIDIA P6', 'NVIDIA P40', 'NVIDIA P100',
  'NVIDIA V100', 'NVIDIA T4', 'NVIDIA A10', 'NVIDIA A16', 'NVIDIA A30',
  'NVIDIA A40', 'NVIDIA A100', 'NVIDIA L40', 'NVIDIA H100', 'NVIDIA H200'
];

const CEM_PACKS: { key: CemPackSize, label: string }[] = [
    { key: '100', label: '100 Agents' },
    { key: '500', label: '500 Agents' },
    { key: '1k', label: '1K Agents' },
    { key: '5k', label: '5K Agents' },
    { key: '10k', label: '10K Agents' },
    { key: '30k', label: '30K Agents' },
    { key: '50k', label: '50K Agents' },
    { key: '100k', label: '100K Agents' },
];

const SKU_DESCRIPTIONS: { [key: string]: string } = {
  'CDP-CFM-4-BUS': 'Cloudera Flow Management - Annual Subscription, 4 Cores, Including Edge Flow Manager and 5 Cloudera Edge Management Agents per license. Business Support.',
  'CDP-PVC-CGU': 'Cloudera on premises - CGU: Priced per Cloudera GPU Unit per year.',
  'CE-OBS-OP-STD': 'Cloudera Observability On-Premises* - Standard. Cloudera Observability On-Premises is an on-premise software - Annual Subscription per Cloudera Compute Unit (CCU). Observability is licensed for the number of CCUs in the customer environment where Cloudera products are managed by Cloudera Observability. Standard Level Support.',
  'CE-OBS-OP-BUS': 'Cloudera Observability On-Premises* - Business. Cloudera Observability On-Premises is an on-premise software - Annual Subscription per Cloudera Compute Unit (CCU). Observability is licensed for the number of CCUs in the customer environment where Cloudera products are managed by Cloudera Observability. Business Level Support.',
  'CE-OBS-OP-SLT': 'Cloudera Observability On-Premises* - Business Select. Cloudera Observability On-Premises is an on-premise software - Annual Subscription per Cloudera Compute Unit (CCU). Observability is licensed for the number of CCUs in the customer environment where Cloudera products are managed by Cloudera Observability. Business Select Level Support.',
};

const NODE_SPECS: { [key: string]: NodeSpec } = {
  master: { id: 'master', name: 'Master Nodes', category: Category.BASE, displayCategory: 'CDP Base', vCPU: 16, memory: 64, storage: 1 },
  worker: { id: 'worker', name: 'Worker Nodes', category: Category.BASE, displayCategory: 'CDP Base', vCPU: 32, memory: 128, storage: 4 },
  edge: { id: 'edge', name: 'Edge Nodes', category: Category.BASE, displayCategory: 'CDP Base', vCPU: 8, memory: 32, storage: 0.5 },
  utility: { id: 'utility', name: 'Utility Nodes', category: Category.BASE, displayCategory: 'CDP Base', vCPU: 8, memory: 32, storage: 0.5 },
  kafka: { id: 'kafka', name: 'Kafka Nodes', category: Category.STREAMING, displayCategory: 'Data-in-Motion', displaySubCategory: 'CDP Streaming', vCPU: 16, memory: 64, storage: 2 },
  flink: { id: 'flink', name: 'Flink Nodes', category: Category.STREAMING, displayCategory: 'Data-in-Motion', displaySubCategory: 'CDP Streaming', vCPU: 16, memory: 64, storage: 1 },
  nifi: { id: 'nifi', name: 'NiFi Nodes', category: Category.DATAFLOW, displayCategory: 'Data-in-Motion', displaySubCategory: 'DataFlow (NiFi)', vCPU: 32, memory: 64, storage: 1 },
  ds_master: { id: 'ds_master', name: 'Data Services Master Nodes', category: Category.DATASERVICES, displayCategory: 'Data Services', vCPU: 16, memory: 64, storage: 1 },
  cdw_cde_worker: { id: 'cdw_cde_worker', name: 'CDW/CDE Worker Nodes', category: Category.DATASERVICES, displayCategory: 'Data Services', vCPU: 32, memory: 128, storage: 2 },
  cai_worker: { id: 'cai_worker', name: 'CAI Worker Nodes', category: Category.DATASERVICES, displayCategory: 'Data Services', vCPU: 16, memory: 64, storage: 1, gpuConfigurable: true },
  ozone_master: { id: 'ozone_master', name: 'Ozone Master Nodes', category: Category.BASE, displayCategory: 'CDP Base', vCPU: 16, memory: 64, storage: 1 },
  ozone_data: { id: 'ozone_data', name: 'Ozone Data Nodes', category: Category.BASE, displayCategory: 'CDP Base', vCPU: 32, memory: 128, storage: 48 },
  kts: { id: 'kts', name: 'Key Trustee Server Nodes', category: Category.BASE, displayCategory: 'CDP Base', vCPU: 8, memory: 16, storage: 0.5 },
  kms: { id: 'kms', name: 'Key Management Server Nodes', category: Category.BASE, displayCategory: 'CDP Base', vCPU: 8, memory: 16, storage: 0.5 },
};

const DISPLAY_CATEGORY_ORDER: DisplayCategory[] = ['CDP Base', 'Data-in-Motion', 'Data Services'];

const initialEnvironmentsData = (): EnvironmentData[] => {
    const baseEnvs: EnvironmentData[] = [
        { id: 'prod_y1', name: 'PROD Y1', type: 'prod', nodes: Object.values(NODE_SPECS), defaultCounts: { master: 3, worker: 20, edge: 2, utility: 2, ozone_master: 3, ozone_data: 10, kts: 2, kms: 2, flink: 5, kafka: 5, nifi: 3, ds_master: 3, cdw_cde_worker: 10, cai_worker: 5 }, defaultGpu: '1_gpu' },
        { id: 'prod_y2', name: 'PROD Y2', type: 'prod', nodes: Object.values(NODE_SPECS), defaultCounts: { master: 3, worker: 30, edge: 4, utility: 2, ozone_master: 3, ozone_data: 20, kts: 2, kms: 2, flink: 10, kafka: 10, nifi: 5, ds_master: 3, cdw_cde_worker: 20, cai_worker: 10 }, defaultGpu: '2_gpu' },
        { id: 'prod_y3', name: 'PROD Y3', type: 'prod', nodes: Object.values(NODE_SPECS), defaultCounts: { master: 3, worker: 40, edge: 4, utility: 4, ozone_master: 5, ozone_data: 30, kts: 2, kms: 2, flink: 15, kafka: 15, nifi: 8, ds_master: 5, cdw_cde_worker: 30, cai_worker: 15 }, defaultGpu: '2_gpu' },
        { id: 'prod_y4', name: 'PROD Y4', type: 'prod', nodes: Object.values(NODE_SPECS), defaultCounts: { master: 5, worker: 50, edge: 6, utility: 4, ozone_master: 5, ozone_data: 40, kts: 2, kms: 2, flink: 20, kafka: 20, nifi: 10, ds_master: 5, cdw_cde_worker: 40, cai_worker: 20 }, defaultGpu: '4_gpu' },
        { id: 'prod_obs', name: 'Onprem OBS', type: 'prod', nodes: Object.values(NODE_SPECS), defaultCounts: { master: 2, worker: 3 }, defaultGpu: 'no_gpu' },
        { id: 'uat', name: 'UAT', type: 'preprod', nodes: Object.values(NODE_SPECS), defaultCounts: { master: 3, worker: 5, edge: 2, utility: 2, ozone_master: 3, ozone_data: 3, kts: 2, kms: 2, flink: 3, kafka: 3, nifi: 2, ds_master: 3, cdw_cde_worker: 3, cai_worker: 2 }, defaultGpu: 'no_gpu' },
        { id: 'dev', name: 'Dev', type: 'preprod', nodes: Object.values(NODE_SPECS), defaultCounts: { master: 3, worker: 10, edge: 2, utility: 2, ozone_master: 3, ozone_data: 5, kts: 2, kms: 2, flink: 5, kafka: 5, nifi: 3, ds_master: 3, cdw_cde_worker: 5, cai_worker: 5 }, defaultGpu: '1_gpu' },
    ];

    const prodY1Defaults = baseEnvs.find(e => e.id === 'prod_y1')!;
    const drEnv: EnvironmentData = { 
        id: 'dr', 
        name: 'DR', 
        type: 'prod', 
        nodes: Object.values(NODE_SPECS), 
        defaultCounts: prodY1Defaults.defaultCounts, 
        defaultGpu: prodY1Defaults.defaultGpu 
    };

    const devIndex = baseEnvs.findIndex(e => e.id === 'dev');
    baseEnvs.splice(devIndex + 1, 0, drEnv);
    
    return baseEnvs;
};
const ENVIRONMENTS_DATA = initialEnvironmentsData();

const getInitialState = (initialEnvs: EnvironmentData[]): AppState => {
  const PROD_Y1_NODE_OVERRIDES: {[nodeId: string]: Partial<EnvironmentNode>} = {
      master:         { count: 3, vCPU: 20, memory: 512, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 1, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 2, size: 8, unit: 'TB' }] },
      worker:         { count: 3, vCPU: 16, memory: 256, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 1, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 6, size: 8, unit: 'TB' }] },
      edge:           { count: 2, vCPU: 16, memory: 256, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 1, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 2, size: 8, unit: 'TB' }] },
      utility:        { count: 2, vCPU: 16, memory: 128, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 1, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 2, size: 8, unit: 'TB' }] },
      ozone_master:   { count: 3, vCPU: 20, memory: 256, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 2, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 2, size: 8, unit: 'TB' }] },
      ozone_data:     { count: 6, vCPU: 24, memory: 512, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 2, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 24, size: 16, unit: 'TB' }] },
      kts:            { count: 0, vCPU: 8,  memory: 32,  cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 0.5, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 1, size: 0.5, unit: 'TB' }] },
      kms:            { count: 2, vCPU: 4,  memory: 32,  cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 0.5, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 2, size: 0.5, unit: 'TB' }] },
      flink:          { count: 3, vCPU: 16, memory: 256, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 1, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 6, size: 8, unit: 'TB' }] },
      kafka:          { count: 3, vCPU: 8,  memory: 128, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 1, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 6, size: 8, unit: 'TB' }] },
      nifi:           { count: 3, vCPU: 16, memory: 128, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 1, unit: 'TB' }, { id: crypto.randomUUID(), type: 'hdd', quantity: 2, size: 8, unit: 'TB' }] },
      ds_master:      { count: 3, vCPU: 16, memory: 64,  cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 1, unit: 'TB' }] },
      cdw_cde_worker: { count: 0, vCPU: 24, memory: 512, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 2, unit: 'TB' }] },
      cai_worker:     { count: 2, vCPU: 24, memory: 512, cpuType: 'physical', disks: [{ id: crypto.randomUUID(), type: 'ssd', quantity: 2, size: 2, unit: 'TB' }], gpuModel: 'NVIDIA L40', gpuQuantity: 1 },
  };
  
  return initialEnvs.reduce((acc, env) => {
    const isProdY1 = env.id === 'prod_y1';
    const isDr = env.id === 'dr';
    const isObsEnv = env.id === 'prod_obs';
    const specsToUse = isObsEnv 
        ? [NODE_SPECS.master, NODE_SPECS.worker] 
        : Object.values(NODE_SPECS);

    const nodes = specsToUse.map((spec, index) => {
        const vCPU = isObsEnv ? 16 : spec.vCPU;
        const memory = isObsEnv ? 128 : spec.memory;

        const defaultDisks: NodeDisk[] = spec.storage > 0 ? [{
            id: crypto.randomUUID(),
            type: 'ssd',
            quantity: 1,
            size: spec.storage,
            unit: 'TB',
        }] : [];
      
        const node: EnvironmentNode = {
            id: spec.id,
            name: spec.name,
            category: spec.category,
            displayCategory: spec.displayCategory,
            displaySubCategory: spec.displaySubCategory,
            gpuConfigurable: spec.gpuConfigurable,
            vCPU: vCPU,
            memory: memory,
            count: env.defaultCounts[spec.id] || 0,
            order: index,
            cpuType: 'virtual',
            disks: defaultDisks,
        };

        if (isProdY1 || isDr) {
            const overrides = PROD_Y1_NODE_OVERRIDES[spec.id];
            if (overrides) {
                Object.assign(node, overrides);
            }
        } else {
            if (spec.gpuConfigurable) {
                node.gpuModel = 'NVIDIA T4';
                switch (env.defaultGpu) {
                    case '1_gpu': node.gpuQuantity = 1; break;
                    case '2_gpu': node.gpuQuantity = 2; break;
                    case '4_gpu': node.gpuQuantity = 4; break;
                    default: node.gpuQuantity = 0;
                }
            }
        }

        return node;
    });
    
    acc[env.id] = { 
        nodes,
        caiUserPack: 0,
        caiAdminPacks: 0,
        cemPacks: {},
        monitoredEnvIds: [],
    };
    
    if (env.id === 'prod_obs') {
        acc[env.id].monitoredEnvIds = initialEnvs.filter(e => e.id !== 'prod_obs').map(e => e.id);
    }

    return acc;
  }, {} as AppState);
};

const calculateTotals = (envState: AppState[string]): { licenseTotals: LicenseTotalsByCategory, displayTotals: DisplayTotals } => {
    const licenseTotals: LicenseTotalsByCategory = {
        [Category.BASE]: { vCPU: 0, memory: 0, storage: 0, nodeCount: 0 },
        [Category.STREAMING]: { vCPU: 0, memory: 0, storage: 0, nodeCount: 0 },
        [Category.ECS]: { vCPU: 0, memory: 0, storage: 0, nodeCount: 0 },
        [Category.ML]: { vCPU: 0, memory: 0, storage: 0, nodeCount: 0 },
        [Category.DATASERVICES]: { vCPU: 0, memory: 0, storage: 0, nodeCount: 0 },
        [Category.DATAFLOW]: { vCPU: 0, memory: 0, storage: 0, nodeCount: 0 },
        [Category.SPECIAL]: { nodes: {} },
    };
    const displayTotals: DisplayTotals = {
        cdpBase: { vCPU: 0, memory: 0, storage: 0, nodeCount: 0 },
        cdpStreaming: { vCPU: 0, memory: 0, storage: 0, nodeCount: 0 },
        dataflow: { vCPU: 0, memory: 0, storage: 0 },
        dataServices: { master_vCPU: 0, master_memory: 0, master_storage: 0, worker_vCPU: 0, worker_memory: 0, worker_storage: 0, totalGpu: 0 },
    };

    if (!envState?.nodes) return { licenseTotals, displayTotals };

    envState.nodes.forEach(node => {
        const count = node.count || 0;
        if (count === 0) return;

        const nodeStorageTB = node.disks.reduce((sum, disk) => {
            const sizeInTB = disk.unit === 'TB' ? disk.size : disk.size / 1024;
            return sum + (disk.quantity * sizeInTB);
        }, 0);
        
        const hyperthreadingMultiplier = node.cpuType === 'physical' ? 2 : 1;
        const nodeTotalVCPU = count * node.vCPU * hyperthreadingMultiplier;
        const nodeTotalMemory = count * node.memory;
        const nodeTotalStorage = count * nodeStorageTB;
        
        const categoryTotals = licenseTotals[node.category];
        if ('vCPU' in categoryTotals) {
             categoryTotals.vCPU += nodeTotalVCPU;
             categoryTotals.memory += nodeTotalMemory;
             categoryTotals.storage += nodeTotalStorage;
             categoryTotals.nodeCount += count;
        } else if ('nodes' in categoryTotals) {
             categoryTotals.nodes[node.id] = (categoryTotals.nodes[node.id] || 0) + count;
        }
        
        switch (node.displayCategory) {
            case 'CDP Base':
                displayTotals.cdpBase.vCPU += nodeTotalVCPU;
                displayTotals.cdpBase.memory += nodeTotalMemory;
                displayTotals.cdpBase.storage += nodeTotalStorage;
                displayTotals.cdpBase.nodeCount += count;
                break;
            case 'Data-in-Motion':
                if (node.displaySubCategory === 'CDP Streaming') {
                    displayTotals.cdpStreaming.vCPU += nodeTotalVCPU;
                    displayTotals.cdpStreaming.memory += nodeTotalMemory;
                    displayTotals.cdpStreaming.storage += nodeTotalStorage;
                    displayTotals.cdpStreaming.nodeCount += count;
                } else { // DataFlow
                    displayTotals.dataflow.vCPU += nodeTotalVCPU;
                    displayTotals.dataflow.memory += nodeTotalMemory;
                    displayTotals.dataflow.storage += nodeTotalStorage;
                }
                break;
            case 'Data Services':
                if (node.id.includes('master')) {
                    displayTotals.dataServices.master_vCPU += nodeTotalVCPU;
                    displayTotals.dataServices.master_memory += nodeTotalMemory;
                    displayTotals.dataServices.master_storage += nodeTotalStorage;
                } else {
                    displayTotals.dataServices.worker_vCPU += nodeTotalVCPU;
                    displayTotals.dataServices.worker_memory += nodeTotalMemory;
                    displayTotals.dataServices.worker_storage += nodeTotalStorage;
                    if (node.gpuConfigurable) {
                        displayTotals.dataServices.totalGpu += count * (node.gpuQuantity || 0);
                    }
                }
                break;
        }
    });

    return { licenseTotals, displayTotals };
};

const getCategoryForSku = (sku: string): { displayCategory: DisplayCategory; displaySubCategory?: DisplaySubCategory } => {
    if (sku.startsWith('COP-BASE-') || sku.startsWith('CE-OBS-OP-')) {
        return { displayCategory: 'CDP Base' };
    }
    if (sku.startsWith('COP-STREAM-')) {
        return { displayCategory: 'Data-in-Motion', displaySubCategory: 'CDP Streaming' };
    }
    if (sku.startsWith('CDP-CFM-') || sku.startsWith('CDF-CEM-')) {
        return { displayCategory: 'Data-in-Motion', displaySubCategory: 'DataFlow (NiFi)' };
    }
    if (sku.startsWith('CDP-PVC-DTSC-') || sku.startsWith('CDP-PVC-CML-') || sku.startsWith('CDP-PVC-CGU')) {
        return { displayCategory: 'Data Services' };
    }
    return { displayCategory: 'CDP Base' }; // Fallback
};

const calculateLicensesForEnv = (
    totals: LicenseTotalsByCategory, 
    envState: AppState[string],
    supportLevel: SupportLevel,
): CategorizedLicense[] => {
    if (!envState) return [];
    const { nodes, caiUserPack, caiAdminPacks, cemPacks } = envState;

    const supportLevelSuffixMap: { [key in SupportLevel]: string } = {
        'Standard': 'STD',
        'Business': 'BUS',
        'Business Select': 'SLT'
    };
    const supportSuffix = supportLevelSuffixMap[supportLevel];
        
    const licenses: CategorizedLicense[] = [];

    // ----- CDP BASE Calculation -----
    const cdpBaseCCUSku = `COP-BASE-CCU-${supportSuffix}`;
    const cdpBaseDUMSku = `COP-BASE-DUM-${supportSuffix}`;
    
    const calculatedCdpBaseCCU = Math.ceil((totals.BASE.vCPU / 6) + (totals.BASE.memory / 12));
    const minimumCdpBaseCCU = totals.BASE.nodeCount * 16;
    const cdpBaseCCU = Math.max(calculatedCdpBaseCCU, minimumCdpBaseCCU);
    const cdpBaseDUM = Math.ceil(Math.max(totals.BASE.storage, totals.BASE.nodeCount * 20));

    if (cdpBaseCCU > 0) licenses.push({ sku: cdpBaseCCUSku, description: `Cloudera Base on premises - Annual Subscription per CCU for compute. ${supportLevel}-Level Support.`, quantity: cdpBaseCCU, ...getCategoryForSku(cdpBaseCCUSku) });
    if (cdpBaseDUM > 0) licenses.push({ sku: cdpBaseDUMSku, description: `Cloudera Base on premises - Annual Subscription per TB for Data Under Management. ${supportLevel}-Level Support.`, quantity: cdpBaseDUM, ...getCategoryForSku(cdpBaseDUMSku) });

    // ----- Streaming Calculation -----
    const calculatedStreamingCCU = Math.ceil((totals.STREAMING.vCPU / 6) + (totals.STREAMING.memory / 12));
    const minimumStreamingCCU = totals.STREAMING.nodeCount * 16;
    const streamingCCU = Math.max(calculatedStreamingCCU, minimumStreamingCCU);
    const streamingDUM = Math.ceil(Math.max(totals.STREAMING.storage, totals.STREAMING.nodeCount * 20));

    if (streamingCCU > 0) {
        const sku = `COP-STREAM-CCU-${supportSuffix}`;
        licenses.push({ sku, description: `Cloudera Streaming on premises - Annual Subscription per CCU for compute. ${supportLevel}-Level Support.`, quantity: streamingCCU, ...getCategoryForSku(sku) });
    }
    if (streamingDUM > 0) {
        const sku = `COP-STREAM-DUM-${supportSuffix}`;
        licenses.push({ sku, description: `Cloudera Streaming on premises - Annual Subscription per TB for Data Under Management. ${supportLevel}-Level Support.`, quantity: streamingDUM, ...getCategoryForSku(sku) });
    }
    
    // ----- Cloudera DataFlow (NiFi) Calculation -----
    const dataflowTotalVCPU = totals.DATAFLOW.vCPU;
    if (dataflowTotalVCPU > 0) {
        const sku = 'CDP-CFM-4-BUS';
        const quantity = Math.ceil(dataflowTotalVCPU / 4);
        if (quantity > 0) licenses.push({ sku, description: SKU_DESCRIPTIONS[sku], quantity, ...getCategoryForSku(sku) });
    }

    // ----- Cloudera Edge Management (CEM) Calculation -----
    if (cemPacks) {
        Object.entries(cemPacks).forEach(([packKey, quantity]) => {
            if (quantity && quantity > 0) {
                const sku = `CDF-CEM-${packKey.toUpperCase()}-BUS`;
                const desc = `Cloudera Edge Management, ${packKey.replace('k', 'K')} Agents Subscription - Business`;
                licenses.push({ sku, description: desc, quantity, ...getCategoryForSku(sku) });
            }
        });
    }

    // ----- Data Services Calculation -----
    const calculatedDsCCU = Math.ceil((totals.DATASERVICES.vCPU / 6) + (totals.DATASERVICES.memory / 12));
    const minimumDsCCU = totals.DATASERVICES.nodeCount * 16;
    const dsCCU = Math.max(calculatedDsCCU, minimumDsCCU);

    if (dsCCU > 0) {
        const sku = `CDP-PVC-DTSC-CCU-${supportSuffix}`;
        licenses.push({ sku, description: `Cloudera Data Services on premises per CCU - ${supportLevel}.`, quantity: dsCCU, ...getCategoryForSku(sku) });
    }

    // ----- Cloudera AI (CML) User Packs Calculation -----
    if (caiUserPack > 0) {
        const sku = `CDP-PVC-CML-${caiUserPack}`;
        licenses.push({ sku, description: `Cloudera Data Services on premises - AI, ${caiUserPack} User Pack`, quantity: 1, ...getCategoryForSku(sku) });
    }
    if (caiAdminPacks > 0) {
        const sku = `CDP-PVC-CML-ADMIN`;
        licenses.push({ sku, description: `Cloudera Data Services on premises - AI, 5 Admin User Pack`, quantity: caiAdminPacks, ...getCategoryForSku(sku) });
    }

    // ----- GPU Calculation -----
    const totalGpuUnits = nodes.reduce((total, node) => {
        if (!node.gpuConfigurable || !node.gpuQuantity) return total;
        const multiplier = (node.gpuModel === 'NVIDIA H100' || node.gpuModel === 'NVIDIA H200') ? 2 : 1;
        return total + (node.count * node.gpuQuantity * multiplier);
    }, 0);

    if (totalGpuUnits > 0) {
        const sku = 'CDP-PVC-CGU';
        licenses.push({ sku, description: SKU_DESCRIPTIONS[sku], quantity: Math.ceil(totalGpuUnits), ...getCategoryForSku(sku) });
    }

    return licenses.filter(l => l.quantity > 0);
};

const addObservabilityLicenses = (
    allCalculatedLicenses: { [envId: string]: CategorizedLicense[] },
    appState: SessionAppState
): { [envId: string]: CategorizedLicense[] } => {
    const { environmentsState, supportLevel, environments } = appState;

    const obsEnv = environments.find(e => e.id === 'prod_obs');
    if (!obsEnv) return allCalculatedLicenses;

    const obsEnvId = obsEnv.id;
    const obsLicenses = allCalculatedLicenses[obsEnvId];
    if (!obsLicenses) return allCalculatedLicenses;

    const supportLevelSuffixMap: { [key in SupportLevel]: string } = {
        'Standard': 'STD',
        'Business': 'BUS',
        'Business Select': 'SLT'
    };
    const supportSuffix = supportLevelSuffixMap[supportLevel];
    const cdpBaseCCUSkuForObs = `COP-BASE-CCU-${supportSuffix}`;
    
    const obsBaseCcuLicense = obsLicenses.find(l => l.sku === cdpBaseCCUSkuForObs);

    if (!obsBaseCcuLicense || obsBaseCcuLicense.quantity === 0) {
        return allCalculatedLicenses;
    }

    const monitoredEnvIds = environmentsState[obsEnvId]?.monitoredEnvIds || [];
    const envsToUpdate = new Set([...monitoredEnvIds, obsEnvId]);

    const newAllCalculatedLicenses = JSON.parse(JSON.stringify(allCalculatedLicenses));

    envsToUpdate.forEach(envId => {
        const targetEnvLicenses = newAllCalculatedLicenses[envId];
        if (!targetEnvLicenses) return;

        const cdpBaseCCUSkuForTarget = `COP-BASE-CCU-${supportSuffix}`;
        const targetEnvBaseCcuLicense = targetEnvLicenses.find(l => l.sku === cdpBaseCCUSkuForTarget);

        if (targetEnvBaseCcuLicense && targetEnvBaseCcuLicense.quantity > 0) {
            const obsSku = `CE-OBS-OP-${supportSuffix}`;
            const description = SKU_DESCRIPTIONS[obsSku] || `Cloudera Observability On-Premises - ${supportLevel}`;

            const newLicense: CategorizedLicense = {
                sku: obsSku,
                description: description,
                quantity: targetEnvBaseCcuLicense.quantity,
                ...getCategoryForSku(obsSku)
            };
            
            if (!targetEnvLicenses.some((l:any) => l.sku === obsSku)) {
                targetEnvLicenses.push(newLicense);
            }
        }
    });

    return newAllCalculatedLicenses;
};


// UI COMPONENTS
const Card: React.FC<{children: React.ReactNode, title: string, actions?: React.ReactNode}> = ({ children, title, actions }) => (
    <div className="bg-cloudera-card-bg/70 rounded-lg shadow-lg p-6">
        <div className="flex justify-between items-center mb-4 border-b border-cloudera-accent-blue/30 pb-2">
            <h2 className="text-xl font-bold text-cloudera-orange">{title}</h2>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        {children}
    </div>
);

const ReadOnlyField: React.FC<{label: string, value: string | number, unit?: string}> = ({ label, value, unit }) => (
    <div className="flex justify-between items-center py-2 border-b border-cloudera-accent-blue/20">
        <span className="text-gray-300">{label}</span>
        <span className="font-mono text-lg text-gray-50 font-bold">{value} <span className="text-sm font-normal text-gray-300">{unit}</span></span>
    </div>
);

interface EditableNodeRowProps {
  node: EnvironmentNode;
  onNodeChange: (nodeId: string, field: keyof EnvironmentNode, value: any) => void;
  onDiskChange: (nodeId: string, diskId: string, field: keyof NodeDisk, value: any) => void;
  onAddDisk: (nodeId: string) => void;
  onRemoveDisk: (nodeId: string, diskId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onDelete: () => void;
  isDeletable: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, nodeId: string) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, targetNodeId: string) => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  isDraggedOver: boolean;
}

const EditableNodeRow: React.FC<EditableNodeRowProps> = React.memo(({ node, onNodeChange, onDiskChange, onAddDisk, onRemoveDisk, onDuplicate, onDelete, isDeletable, onDragStart, onDragOver, onDrop, onDragEnter, onDragLeave, isDraggedOver }) => {
    return (
        <div 
            onDrop={(e) => onDrop(e, node.id)}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            className={`bg-cloudera-accent-blue/10 p-4 rounded-lg border border-cloudera-accent-blue/20 space-y-4 transition-all duration-200 ${isDraggedOver ? 'ring-2 ring-cloudera-orange' : ''}`}
        >
            <div className="flex items-center gap-4">
                <div 
                    draggable 
                    onDragStart={(e) => onDragStart(e, node.id)}
                    onDragOver={onDragOver}
                    className="cursor-move text-gray-400 hover:text-white" title="Drag to reorder"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM13 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2h-2z" /></svg>
                </div>
                <input 
                    type="text"
                    value={node.name}
                    onChange={e => onNodeChange(node.id, 'name', e.target.value)}
                    className="text-lg font-bold text-gray-100 flex-grow bg-transparent focus:bg-cloudera-accent-blue/20 rounded p-1 -m-1 outline-none focus:ring-1 focus:ring-cloudera-orange"
                />
                <button onClick={() => onDuplicate(node.id)} title="Duplicate Node" className="p-1 text-gray-400 hover:text-cloudera-orange">
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                     <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
                     <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h6a2 2 0 00-2-2H5z" />
                   </svg>
                </button>
                {isDeletable && (
                    <button onClick={onDelete} title="Delete Node" className="p-1 text-gray-400 hover:text-red-500">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                           <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1zm4 0a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1z" clipRule="evenodd" />
                        </svg>
                    </button>
                )}
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                    <label className="text-xs text-gray-300"># of Nodes</label>
                    <input type="number" min="0" value={node.count} onChange={e => onNodeChange(node.id, 'count', parseInt(e.target.value, 10))} className="w-full bg-cloudera-deep-blue border border-cloudera-accent-blue/40 rounded-md p-2 text-white focus:ring-1 focus:ring-cloudera-orange" />
                </div>
                <div>
                    <label className="text-xs text-gray-300">Cores / Node</label>
                    <input type="number" min="0" value={node.vCPU} onChange={e => onNodeChange(node.id, 'vCPU', parseInt(e.target.value, 10))} className="w-full bg-cloudera-deep-blue border border-cloudera-accent-blue/40 rounded-md p-2 text-white focus:ring-1 focus:ring-cloudera-orange" />
                </div>
                 <div>
                    <label className="text-xs text-gray-300">CPU Type</label>
                    <select value={node.cpuType} onChange={e => onNodeChange(node.id, 'cpuType', e.target.value)} className="w-full bg-cloudera-deep-blue border border-cloudera-accent-blue/40 rounded-md p-2 text-white focus:ring-1 focus:ring-cloudera-orange">
                        <option value="virtual">Virtual</option>
                        <option value="physical">Physical</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs text-gray-300">RAM / Node (GB)</label>
                    <input type="number" min="0" value={node.memory} onChange={e => onNodeChange(node.id, 'memory', parseInt(e.target.value, 10))} className="w-full bg-cloudera-deep-blue border border-cloudera-accent-blue/40 rounded-md p-2 text-white focus:ring-1 focus:ring-cloudera-orange" />
                </div>
            </div>

            {node.gpuConfigurable && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div>
                        <label className="text-xs text-gray-300">GPU Quantity</label>
                        <input type="number" min="0" value={node.gpuQuantity || 0} onChange={e => onNodeChange(node.id, 'gpuQuantity', parseInt(e.target.value, 10))} className="w-full bg-cloudera-deep-blue border border-cloudera-accent-blue/40 rounded-md p-2 text-white focus:ring-1 focus:ring-cloudera-orange" />
                    </div>
                    <div>
                        <label className="text-xs text-gray-300">GPU Model</label>
                        <select value={node.gpuModel || ''} onChange={e => onNodeChange(node.id, 'gpuModel', e.target.value)} className="w-full bg-cloudera-deep-blue border border-cloudera-accent-blue/40 rounded-md p-2 text-white focus:ring-1 focus:ring-cloudera-orange" disabled={!node.gpuQuantity || node.gpuQuantity === 0}>
                            <option value="">{ !node.gpuQuantity || node.gpuQuantity === 0 ? "No GPUs selected" : "Select a model..."}</option>
                            {GPU_MODELS.map(model => <option key={model} value={model}>{model}</option>)}
                        </select>
                    </div>
                </div>
            )}

            <div>
                <label className="text-sm font-semibold text-gray-200 mb-2 block">Disk Configuration</label>
                <div className="space-y-2">
                    {node.disks.map(disk => (
                        <div key={disk.id} className="grid grid-cols-12 gap-2 items-center">
                            <select value={disk.type} onChange={e => onDiskChange(node.id, disk.id, 'type', e.target.value)} className="col-span-3 bg-cloudera-card-bg border border-cloudera-accent-blue/40 rounded-md p-2 text-white text-sm">
                                <option value="ssd">SSD</option><option value="hdd">HDD</option><option value="nvme">NVMe</option>
                            </select>
                            <input type="number" min="1" value={disk.quantity} onChange={e => onDiskChange(node.id, disk.id, 'quantity', parseInt(e.target.value, 10))} className="col-span-2 bg-cloudera-card-bg border border-cloudera-accent-blue/40 rounded-md p-2 text-white text-sm" />
                            <span className="text-gray-300 text-center col-span-1">x</span>
                            <input type="number" min="1" value={disk.size} onChange={e => onDiskChange(node.id, disk.id, 'size', parseInt(e.target.value, 10))} className="col-span-2 bg-cloudera-card-bg border border-cloudera-accent-blue/40 rounded-md p-2 text-white text-sm" />
                            <select value={disk.unit} onChange={e => onDiskChange(node.id, disk.id, 'unit', e.target.value)} className="col-span-2 bg-cloudera-card-bg border border-cloudera-accent-blue/40 rounded-md p-2 text-white text-sm">
                                <option value="GB">GB</option><option value="TB">TB</option>
                            </select>
                            <button onClick={() => onRemoveDisk(node.id, disk.id)} className="col-span-2 text-gray-400 hover:text-red-500" title="Remove Disk">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mx-auto" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>
                            </button>
                        </div>
                    ))}
                    <button onClick={() => onAddDisk(node.id)} className="text-sm text-cloudera-orange hover:text-orange-400">+ Add Disk</button>
                </div>
            </div>
        </div>
    );
});

const CollapsibleSection: React.FC<{ title: string, children: React.ReactNode, isOpen: boolean, onToggle: () => void, hasData?: boolean }> = ({ title, children, isOpen, onToggle, hasData = true }) => {
    if (!hasData) return null;

    return (
        <div className="bg-transparent rounded-lg border border-cloudera-accent-blue/20">
            <button
                onClick={onToggle}
                className="w-full flex justify-between items-center p-4 bg-cloudera-accent-blue/10 hover:bg-cloudera-accent-blue/20 rounded-t-lg"
            >
                <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
                <svg
                    className={`w-5 h-5 text-gray-300 transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {isOpen && <div className="p-4 space-y-4">{children}</div>}
        </div>
    );
};


interface EnvironmentTabProps {
    envData: EnvironmentData;
    envState: AppState[string];
    onNodeChange: (envId: string, nodeId: string, field: keyof EnvironmentNode, value: any) => void;
    onEnvConfigChange: (envId: string, field: 'caiUserPack' | 'caiAdminPacks' | 'cemPacks', value: any) => void;
    onDiskChange: (envId: string, nodeId: string, diskId: string, field: keyof NodeDisk, value: any) => void;
    onAddDisk: (envId: string, nodeId: string) => void;
    onRemoveDisk: (envId: string, nodeId: string, diskId: string) => void;
    onReorder: (envId: string, draggedId: string, targetId: string) => void;
    onDuplicateNode: (envId: string, nodeId: string) => void;
    onDeleteNode: (envId: string, nodeId: string) => void;
    calculatedLicenses: CategorizedLicense[];
    displayTotals: DisplayTotals;
    allEnvironments: EnvironmentData[];
    onMonitoredEnvsChange: (envId: string, selectedIds: string[]) => void;
}

const LicenseTable: React.FC<{ licenses: CategorizedLicense[] }> = ({ licenses }) => {
    if (!licenses || licenses.length === 0) return null;
    return (
        <div className="overflow-x-auto mt-6">
            <h4 className="text-md font-semibold text-gray-200 mb-2 border-b border-cloudera-accent-blue/20 pb-1">Required Licenses</h4>
            <table className="w-full text-left text-sm">
                <thead className="text-xs text-gray-300 uppercase bg-cloudera-accent-blue/10">
                    <tr>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Description</th>
                        <th className="px-3 py-2 text-right">Quantity</th>
                    </tr>
                </thead>
                <tbody>
                    {licenses.map(license => (
                        <tr key={license.sku} className="border-b border-cloudera-accent-blue/20">
                            <td className="px-3 py-2 font-mono">{license.sku}</td>
                            <td className="px-3 py-2">{license.description}</td>
                            <td className="px-3 py-2 font-mono text-right text-base font-bold">{license.quantity.toLocaleString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const EnvironmentTab: React.FC<EnvironmentTabProps> = ({ envData, envState, onNodeChange, onEnvConfigChange, onDiskChange, onAddDisk, onRemoveDisk, onReorder, onDuplicateNode, onDeleteNode, calculatedLicenses, displayTotals, allEnvironments, onMonitoredEnvsChange }) => {
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
    const isReadOnly = envData.id === 'dr';

    const toggleCategory = useCallback((category: string) => {
        setOpenCategories(prev => {
            const newSet = new Set(prev);
            if (newSet.has(category)) {
                newSet.delete(category);
            } else {
                newSet.add(category);
            }
            return newSet;
        });
    }, []);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, nodeId: string) => { setDraggedId(nodeId); e.dataTransfer.effectAllowed = 'move'; };
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();
    const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
        e.preventDefault();
        if (draggedId && draggedId !== targetId) onReorder(envData.id, draggedId, targetId);
        setDraggedId(null);
        setDragOverId(null);
    };
    const handleDragEnter = (targetId: string) => { if(draggedId && draggedId !== targetId) setDragOverId(targetId); };

    const sortedNodes = useMemo(() => [...envState.nodes].sort((a, b) => a.order - b.order), [envState.nodes]);

    const nodeGroups = useMemo(() => {
        const groups: { [key in DisplayCategory]?: { [key: string]: EnvironmentNode[] } } = {};
        sortedNodes.forEach(node => {
            if (!groups[node.displayCategory]) groups[node.displayCategory] = {};
            const subCategoryKey = node.displaySubCategory || 'default';
            if (!groups[node.displayCategory]![subCategoryKey]) groups[node.displayCategory]![subCategoryKey] = [];
            groups[node.displayCategory]![subCategoryKey].push(node);
        });
        return groups;
    }, [sortedNodes]);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-4 md:p-8">
            <Card title="INPUTS & CONFIGURATION">
                {isReadOnly && (
                    <div className="p-3 mb-4 text-center bg-cloudera-accent-blue/20 rounded-lg text-gray-300 text-sm">
                        This is a Disaster Recovery environment and is synchronized with <strong>PROD Y1</strong>. All configurations are read-only.
                    </div>
                )}
                 <fieldset disabled={isReadOnly} className="space-y-4">
                    {DISPLAY_CATEGORY_ORDER.map(categoryName => {
                        const subCategoryGroups = nodeGroups[categoryName];
                        if (!subCategoryGroups) return null;

                        return (
                            <CollapsibleSection 
                                key={categoryName} 
                                title={categoryName}
                                isOpen={openCategories.has(categoryName)}
                                onToggle={() => toggleCategory(categoryName)}
                            >
                                {Object.entries(subCategoryGroups).map(([subCategoryName, nodes]) => (
                                    <div key={subCategoryName}>
                                        {subCategoryName !== 'default' && (<h4 className="text-md font-bold text-cloudera-accent-blue mb-2 border-b border-cloudera-accent-blue/30 pb-1">{subCategoryName}</h4>)}
                                        <div className="space-y-4">
                                            {nodes.map(node => <EditableNodeRow key={node.id} node={node} onNodeChange={(...args) => onNodeChange(envData.id, ...args)} onDiskChange={(...args) => onDiskChange(envData.id, ...args)} onAddDisk={() => onAddDisk(envData.id, node.id)} onRemoveDisk={(nodeId, diskId) => onRemoveDisk(envData.id, nodeId, diskId)} onDuplicate={() => onDuplicateNode(envData.id, node.id)} onDelete={() => onDeleteNode(envData.id, node.id)} isDeletable={!Object.prototype.hasOwnProperty.call(NODE_SPECS, node.id)} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onDragEnter={() => handleDragEnter(node.id)} onDragLeave={() => setDragOverId(null)} isDraggedOver={dragOverId !== null && dragOverId === node.id} />)}
                                        </div>
                                        {subCategoryName === 'DataFlow (NiFi)' && (
                                            <div className="mt-4 p-4 border-t border-cloudera-accent-blue/20"><h4 className="text-md font-bold text-gray-200 mb-2">Cloudera Edge Management</h4><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{CEM_PACKS.map(pack => (<div key={pack.key}><label className="text-xs text-gray-300"># of {pack.label} Packs</label><input type="number" min="0" value={envState.cemPacks?.[pack.key] || 0} onChange={e => onEnvConfigChange(envData.id, 'cemPacks', { ...(envState.cemPacks || {}), [pack.key]: parseInt(e.target.value, 10) || 0 })} className="w-full bg-cloudera-deep-blue border border-cloudera-accent-blue/40 rounded-md p-2 text-white focus:ring-1 focus:ring-cloudera-orange"/></div>))}</div></div>
                                        )}
                                    </div>
                                ))}
                                {categoryName === 'Data Services' && (
                                    <div className="mt-4 p-4 border-t border-cloudera-accent-blue/20"><h4 className="text-md font-bold text-gray-200 mb-2">Cloudera AI Configuration</h4><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><label className="text-xs text-gray-300">CAI User Pack</label><select value={envState.caiUserPack || 0} onChange={e => onEnvConfigChange(envData.id, 'caiUserPack', Number(e.target.value) as 0 | 5 | 10 | 100 | 500)} className="w-full bg-cloudera-deep-blue border border-cloudera-accent-blue/40 rounded-md p-2 text-white focus:ring-1 focus:ring-cloudera-orange"><option value="0">None</option><option value="5">5 User Pack</option><option value="10">10 User Pack</option><option value="100">100 User Pack</option><option value="500">500 User Pack</option></select></div><div><label className="text-xs text-gray-300"># of 5-Admin-User Packs</label><input type="number" min="0" value={envState.caiAdminPacks || 0} onChange={e => onEnvConfigChange(envData.id, 'caiAdminPacks', Number(e.target.value) || 0)} className="w-full bg-cloudera-deep-blue border border-cloudera-accent-blue/40 rounded-md p-2 text-white focus:ring-1 focus:ring-cloudera-orange"/></div></div></div>
                                )}
                            </CollapsibleSection>
                        )
                    })}
                    {envData.id === 'prod_obs' && (
                      <div className="mt-4 p-4 border-t border-cloudera-accent-blue/20">
                          <h4 className="text-md font-bold text-gray-200 mb-2">Monitored Environments</h4>
                          <p className="text-sm text-gray-400 mb-3">Select the environments that this Observability cluster will monitor.</p>
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                              {allEnvironments
                                  .filter(env => env.id !== envData.id)
                                  .map(env => (
                                      <label key={env.id} className="flex items-center p-2 rounded-md bg-cloudera-deep-blue/50 cursor-pointer hover:bg-cloudera-accent-blue/20">
                                          <input
                                              type="checkbox"
                                              checked={envState.monitoredEnvIds?.includes(env.id) || false}
                                              onChange={(e) => {
                                                  const isChecked = e.target.checked;
                                                  const currentIds = envState.monitoredEnvIds || [];
                                                  const newIds = isChecked
                                                      ? [...currentIds, env.id]
                                                      : currentIds.filter(id => id !== env.id);
                                                  onMonitoredEnvsChange(envData.id, newIds);
                                              }}
                                              className="h-4 w-4 rounded bg-cloudera-card-bg border-cloudera-accent-blue text-cloudera-orange focus:ring-cloudera-orange"
                                          />
                                          <span className="ml-3 text-white">{env.name}</span>
                                      </label>
                                  ))
                              }
                          </div>
                      </div>
                    )}
                 </fieldset>
            </Card>

            <div className="space-y-8">
                <Card title="SUMMARY & BILL OF QUANTITIES">
                    <div className="space-y-6">
                        <CollapsibleSection 
                           title="CDP Base" 
                           hasData={displayTotals.cdpBase.nodeCount > 0}
                           isOpen={openCategories.has('CDP Base')}
                           onToggle={() => toggleCategory('CDP Base')}
                        >
                           <ReadOnlyField label="Total Nodes" value={displayTotals.cdpBase.nodeCount} />
                           <ReadOnlyField label="Total vCPU" value={displayTotals.cdpBase.vCPU} />
                           <ReadOnlyField label="Total RAM" value={displayTotals.cdpBase.memory} unit="GB" />
                           <ReadOnlyField label="Total Storage" value={Math.round(displayTotals.cdpBase.storage * 100) / 100} unit="TB" />
                           <LicenseTable licenses={calculatedLicenses.filter(l => l.displayCategory === 'CDP Base')} />
                        </CollapsibleSection>

                        <CollapsibleSection 
                            title="Data-in-Motion" 
                            hasData={displayTotals.cdpStreaming.nodeCount > 0 || displayTotals.dataflow.vCPU > 0}
                            isOpen={openCategories.has('Data-in-Motion')}
                            onToggle={() => toggleCategory('Data-in-Motion')}
                        >
                            <div className="space-y-4">
                               <div className="p-4 rounded-md bg-cloudera-deep-blue/50">
                                   <h4 className="text-md font-bold text-cloudera-accent-blue mb-2">CDP Streaming</h4>
                                   <ReadOnlyField label="Total Nodes" value={displayTotals.cdpStreaming.nodeCount} />
                                   <ReadOnlyField label="Total vCPU" value={displayTotals.cdpStreaming.vCPU} />
                                   <ReadOnlyField label="Total RAM" value={displayTotals.cdpStreaming.memory} unit="GB" />
                                   <ReadOnlyField label="Total Storage" value={Math.round(displayTotals.cdpStreaming.storage * 100) / 100} unit="TB" />
                                   <LicenseTable licenses={calculatedLicenses.filter(l => l.displaySubCategory === 'CDP Streaming')} />
                               </div>
                               <div className="p-4 rounded-md bg-cloudera-deep-blue/50">
                                   <h4 className="text-md font-bold text-cloudera-accent-blue mb-2">DataFlow (NiFi)</h4>
                                   <ReadOnlyField label="Total vCPU" value={displayTotals.dataflow.vCPU} />
                                   <ReadOnlyField label="Total RAM" value={displayTotals.dataflow.memory} unit="GB" />
                                   <ReadOnlyField label="Total Storage" value={Math.round(displayTotals.dataflow.storage * 100) / 100} unit="TB" />
                                   <LicenseTable licenses={calculatedLicenses.filter(l => l.displaySubCategory === 'DataFlow (NiFi)')} />
                               </div>
                           </div>
                        </CollapsibleSection>
                        
                        <CollapsibleSection 
                            title="Data Services" 
                            hasData={displayTotals.dataServices.master_vCPU > 0 || displayTotals.dataServices.worker_vCPU > 0}
                            isOpen={openCategories.has('Data Services')}
                            onToggle={() => toggleCategory('Data Services')}
                        >
                           <div className="pl-4 border-l-2 border-cloudera-accent-blue/30 space-y-3">
                             <div>
                               <h4 className="text-md font-semibold text-gray-300 mb-1">Workers</h4>
                               <ReadOnlyField label="Total Worker vCPU" value={displayTotals.dataServices.worker_vCPU} />
                               <ReadOnlyField label="Total Worker RAM" value={displayTotals.dataServices.worker_memory} unit="GB" />
                               <ReadOnlyField label="Total Worker Storage" value={Math.round(displayTotals.dataServices.worker_storage * 100) / 100} unit="TB" />
                               <ReadOnlyField label="Total CAI GPUs" value={displayTotals.dataServices.totalGpu} unit="GPUs" />
                             </div>
                             <div>
                               <h4 className="text-md font-semibold text-gray-300 mb-1">Masters</h4>
                               <ReadOnlyField label="Total Master vCPU" value={displayTotals.dataServices.master_vCPU} />
                               <ReadOnlyField label="Total Master RAM" value={displayTotals.dataServices.master_memory} unit="GB" />
                               <ReadOnlyField label="Total Master Storage" value={Math.round(displayTotals.dataServices.master_storage * 100) / 100} unit="TB" />
                             </div>
                           </div>
                           <LicenseTable licenses={calculatedLicenses.filter(l => l.displayCategory === 'Data Services')} />
                        </CollapsibleSection>
                    </div>
                </Card>
            </div>
        </div>
    );
};

const getSkuSortPriority = (sku: string): number => {
    if (sku.startsWith('COP-BASE-')) return 1;
    if (sku.startsWith('COP-STREAM-')) return 2;
    if (sku.startsWith('CDP-CFM-') || sku.startsWith('CDF-CEM-')) return 3;
    if (sku.startsWith('CDP-PVC-')) return 4;
    if (sku.startsWith('CE-OBS-OP-')) return 5;
    return 99; // Default for any other SKUs
};

const BoQTab: React.FC<{ allCalculatedLicenses: { [envId: string]: CalculatedLicenses[] }, environments: EnvironmentData[], environmentsState: AppState }> = ({ allCalculatedLicenses, environments, environmentsState }) => {
    const [isHwExportModalOpen, setIsHwExportModalOpen] = useState(false);

    const boqData = useMemo(() => {
        if (!environments || environments.length === 0) return [];
        const allLicensesFlat: CalculatedLicenses[] = Object.values(allCalculatedLicenses).flat();
        const uniqueLicenseTemplates = [...new Map(allLicensesFlat.map(item => [item.sku, item])).values()];
        
        const boq: { [sku: string]: { description: string; quantities: { [envId: string]: number } } } = {};
        
        uniqueLicenseTemplates.forEach(licenseTpl => {
            boq[licenseTpl.sku] = { description: licenseTpl.description, quantities: {} };
            environments.forEach(env => {
                const license = allCalculatedLicenses[env.id]?.find(l => l.sku === licenseTpl.sku);
                boq[licenseTpl.sku].quantities[env.id] = license ? license.quantity : 0;
            });
        });
        
        return Object.entries(boq)
            .filter(([_, data]) => Object.values(data.quantities).some(q => q > 0))
            .sort(([skuA], [skuB]) => {
                const priorityA = getSkuSortPriority(skuA);
                const priorityB = getSkuSortPriority(skuB);
                if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                }
                return skuA.localeCompare(skuB); // Alphabetical sort within the same category
            });

    }, [allCalculatedLicenses, environments]);

    const handleExportBoQ = useCallback(() => {
        const headers = ['SKU', 'Description', ...environments.map(e => e.name)];
        const csvRows = [headers.join(',')];

        boqData.forEach(([sku, data]) => {
            const row = [
                `"${sku}"`,
                `"${(data as any).description.replace(/"/g, '""')}"` // Escape double quotes
            ];
            environments.forEach(env => {
                row.push(String((data as any).quantities[env.id] || '0'));
            });
            csvRows.push(row.join(','));
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', 'cloudera_boq.csv');
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }, [boqData, environments]);
    
    const handleExportHwConfig = useCallback((selectedEnvIds: string[]) => {
        const headers = [
            'Environment Name', 'Node Name', 'Node Count', 'CPU Type', 'Cores/Node', 'Total vCPU',
            'RAM/Node (GB)', 'Total RAM (GB)', 'Disk Type', 'Disk Quantity', 'Disk Size', 'Disk Unit',
            'Total Disk (TB)', 'GPU Model', 'GPU Quantity', 'Total GPUs'
        ];
        const csvRows = [headers.join(',')];

        selectedEnvIds.forEach(envId => {
            const envData = environments.find(e => e.id === envId);
            const envState = environmentsState[envId];
            if (!envData || !envState) return;

            envState.nodes.forEach(node => {
                if (node.count > 0) {
                    const hyperthreadingMultiplier = node.cpuType === 'physical' ? 2 : 1;
                    const totalVCPU = node.count * node.vCPU * hyperthreadingMultiplier;
                    const totalRAM = node.count * node.memory;
                    const totalGpu = node.count * (node.gpuQuantity || 0);
                    
                    if (node.disks.length > 0) {
                        node.disks.forEach(disk => {
                            const sizeInTB = disk.unit === 'TB' ? disk.size : disk.size / 1024;
                            const totalDiskTB = node.count * disk.quantity * sizeInTB;
                            const row = [
                                `"${envData.name}"`, `"${node.name}"`, node.count, node.cpuType, node.vCPU, totalVCPU,
                                node.memory, totalRAM, disk.type, disk.quantity, disk.size, disk.unit,
                                totalDiskTB, `"${node.gpuModel || '-'}"`, node.gpuQuantity || 0, totalGpu
                            ];
                            csvRows.push(row.join(','));
                        });
                    } else {
                        // Node with no disks
                        const row = [
                            `"${envData.name}"`, `"${node.name}"`, node.count, node.cpuType, node.vCPU, totalVCPU,
                            node.memory, totalRAM, '-', 0, 0, '-', 0,
                            `"${node.gpuModel || '-'}"`, node.gpuQuantity || 0, totalGpu
                        ];
                        csvRows.push(row.join(','));
                    }
                }
            });
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'cloudera_hw_config.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setIsHwExportModalOpen(false);
    }, [environments, environmentsState]);


    if (!environments || environments.length === 0) {
      return (
        <div className="p-4 md:p-8">
            <Card title="Bill of Quantities (BoQ) - Detailed Breakdown">
                <p className="text-gray-400">No environments configured. Add an environment to see the Bill of Quantities.</p>
            </Card>
        </div>
      );
    }

    return (
        <div className="p-4 md:p-8">
            {isHwExportModalOpen && (
                <HwExportModal 
                    environments={environments}
                    isOpen={isHwExportModalOpen}
                    onClose={() => setIsHwExportModalOpen(false)}
                    onExport={handleExportHwConfig}
                />
            )}
            <Card 
                title="Bill of Quantities (BoQ) - Detailed Breakdown"
                actions={<>
                    <button onClick={() => setIsHwExportModalOpen(true)} className="flex items-center gap-2 text-sm bg-cloudera-accent-blue/50 hover:bg-cloudera-accent-blue/80 text-white font-bold py-2 px-4 rounded transition-colors duration-200">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h1a1 1 0 001-1V3.5a3.5 3.5 0 00-7 0V4a1 1 0 001 1h1a1 1 0 001-1V3.5z" /><path d="M5.5 11.5A3.5 3.5 0 009 15h2a3.5 3.5 0 003.5-3.5V8a1 1 0 00-1-1h-1a1 1 0 00-1 1v.5a1.5 1.5 0 01-3 0V8a1 1 0 00-1-1h-1a1 1 0 00-1 1v3.5z" /></svg>
                        Export HW Config
                    </button>
                    <button onClick={handleExportBoQ} className="flex items-center gap-2 text-sm bg-cloudera-orange hover:bg-orange-500 text-white font-bold py-2 px-4 rounded transition-colors duration-200">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.707a1 1 0 011.414 0L10 12.001l2.293-2.294a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /><path fillRule="evenodd" d="M10 2a1 1 0 011 1v8a1 1 0 11-2 0V3a1 1 0 011-1z" clipRule="evenodd" /></svg>
                        Export BoQ
                    </button>
                </>}
            >
                <div className="overflow-x-auto rounded-lg">
                    <table className="w-full text-sm text-left table-auto">
                        <thead className="bg-cloudera-accent-blue/20 text-gray-200 uppercase">
                            <tr>
                                <th className="p-3 w-1/5 min-w-[200px]">SKU</th>
                                <th className="p-3 w-2/5">Description</th>
                                {environments.map(env => (
                                    <th key={env.id} className="p-3 text-center" style={{ backgroundColor: env.type === 'prod' ? 'rgba(247, 109, 11, 0.15)' : 'rgba(56, 189, 248, 0.15)'}}>
                                        {env.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-cloudera-card-bg/50">
                            {boqData.map(([sku, data]) => (
                                <tr key={sku} className="border-b border-cloudera-accent-blue/20 hover:bg-cloudera-accent-blue/10">
                                    <td className="p-3 font-mono align-top break-words">{sku}</td>
                                    <td className="p-3 align-top break-words">{(data as any).description}</td>
                                    {environments.map(env => (
                                         <td key={env.id} className="p-3 text-center font-mono font-bold text-lg align-top" style={{ backgroundColor: env.type === 'prod' ? 'rgba(247, 109, 11, 0.08)' : 'rgba(56, 189, 248, 0.08)'}}>
                                            <span style={{color: ((data as any).quantities[env.id] || 0) > 0 ? (env.type === 'prod' ? '#F76D0B' : '#38bdf8') : 'inherit' }}>
                                              {((data as any).quantities[env.id] || 0) > 0 ? ((data as any).quantities[env.id] || 0).toLocaleString() : '-'}
                                            </span>
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

const HwExportModal: React.FC<{
    environments: EnvironmentData[],
    isOpen: boolean,
    onClose: () => void,
    onExport: (selectedEnvIds: string[]) => void,
}> = ({ environments, isOpen, onClose, onExport }) => {
    const [selectedEnvs, setSelectedEnvs] = useState<Set<string>>(new Set(environments.map(e => e.id)));

    const handleToggle = (envId: string) => {
        setSelectedEnvs(prev => {
            const newSet = new Set(prev);
            if (newSet.has(envId)) {
                newSet.delete(envId);
            } else {
                newSet.add(envId);
            }
            return newSet;
        });
    };
    
    const handleSelectAll = () => setSelectedEnvs(new Set(environments.map(e => e.id)));
    const handleDeselectAll = () => setSelectedEnvs(new Set());

    const handleConfirm = () => {
        onExport(Array.from(selectedEnvs));
    };

    if (!isOpen) return null;

    return (
        <Modal
            title="Export Hardware Configuration"
            onClose={onClose}
            onConfirm={handleConfirm}
            confirmText={`Export (${selectedEnvs.size})`}
            confirmColor="orange"
        >
            <p className="mb-4">Select the environments you want to include in the CSV export.</p>
            <div className="flex gap-2 mb-4">
                <button onClick={handleSelectAll} className="text-sm text-cloudera-orange hover:underline">Select All</button>
                <span className="text-gray-500">|</span>
                <button onClick={handleDeselectAll} className="text-sm text-gray-400 hover:underline">Deselect All</button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                {environments.map(env => (
                    <label key={env.id} className="flex items-center p-2 rounded-md bg-cloudera-deep-blue/50 cursor-pointer hover:bg-cloudera-accent-blue/20">
                        <input
                            type="checkbox"
                            checked={selectedEnvs.has(env.id)}
                            onChange={() => handleToggle(env.id)}
                            className="h-4 w-4 rounded bg-cloudera-card-bg border-cloudera-accent-blue text-cloudera-orange focus:ring-cloudera-orange"
                        />
                        <span className="ml-3 text-white">{env.name}</span>
                    </label>
                ))}
            </div>
        </Modal>
    );
};

const createNewEnvironment = (name: string): { envData: EnvironmentData, envState: AppState[string] } => {
    const newId = crypto.randomUUID();
    const envData: EnvironmentData = {
        id: newId, name: name, type: 'prod', nodes: Object.values(NODE_SPECS), defaultCounts: {}, defaultGpu: 'no_gpu',
    };
    const nodes = Object.values(NODE_SPECS).map((spec, index) => {
        const defaultDisks: NodeDisk[] = spec.storage > 0 ? [{ id: crypto.randomUUID(), type: 'ssd', quantity: 1, size: spec.storage, unit: 'TB' }] : [];
        const node: EnvironmentNode = {
            id: spec.id, name: spec.name, category: spec.category, displayCategory: spec.displayCategory, displaySubCategory: spec.displaySubCategory,
            gpuConfigurable: spec.gpuConfigurable, vCPU: spec.vCPU, memory: spec.memory, count: 0, order: index, cpuType: 'virtual', disks: defaultDisks,
        };
        if (spec.gpuConfigurable) { node.gpuModel = 'NVIDIA T4'; node.gpuQuantity = 0; }
        return node;
    });
    const envState: AppState[string] = { nodes, caiUserPack: 0, caiAdminPacks: 0, cemPacks: {}, monitoredEnvIds: [] };
    return { envData, envState };
};

const createDefaultSession = (name = "My First Calculator"): Session => {
    const defaultEnvs = ENVIRONMENTS_DATA;
    const defaultEnvStates = getInitialState(defaultEnvs);
    return {
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        appState: {
            environments: defaultEnvs,
            environmentsState: defaultEnvStates,
            activeTab: defaultEnvs[0]?.id || 'boq',
            supportLevel: 'Business'
        }
    }
};

const loadWorkspaceFromStorage = (): Workspace => {
    // 1. Try to load new workspace format
    try {
        const savedWorkspace = localStorage.getItem('clouderaCalculatorWorkspace');
        if (savedWorkspace) {
            const parsed = JSON.parse(savedWorkspace);
            delete parsed.sidebarCollapsed; // remove old property if it exists
            return parsed;
        }
    } catch (e) { console.error("Failed to parse workspace from localStorage", e); }
    
    // 2. Try to migrate from old format
    try {
        const oldEnvs = localStorage.getItem('clouderaCalculatorEnvs');
        const oldState = localStorage.getItem('clouderaCalculatorState');
        if (oldEnvs && oldState) {
            const appName = localStorage.getItem('clouderaCalculatorAppName') || 'My Migrated Calculator';
            const supportLevel = (localStorage.getItem('clouderaCalculatorSupportLevel') as SupportLevel) || 'Business';
            const activeTab = localStorage.getItem('clouderaCalculatorActiveTab');
            const environments = JSON.parse(oldEnvs);
            const environmentsState = JSON.parse(oldState);

            const newSession = createDefaultSession(appName);
            newSession.appState = {
                supportLevel,
                environments,
                environmentsState,
                activeTab: activeTab || environments[0]?.id || 'boq',
            };
            
            const migratedWorkspace: Workspace = {
                activeSessionId: newSession.id,
                sessions: [newSession],
            };

            // Clean up old keys
            ['clouderaCalculatorEnvs', 'clouderaCalculatorState', 'clouderaCalculatorAppName', 'clouderaCalculatorActiveTab', 'clouderaCalculatorSupportLevel']
                .forEach(key => localStorage.removeItem(key));
            
            return migratedWorkspace;
        }
    } catch(e) { console.error("Failed to migrate old data", e); }

    // 3. If nothing found, create a fresh workspace
    const firstSession = createDefaultSession();
    return {
        activeSessionId: firstSession.id,
        sessions: [firstSession],
    };
};

// MAIN APP COMPONENT
const App: React.FC = () => {
    const [workspace, setWorkspace] = useState<Workspace | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [workspaceToImport, setWorkspaceToImport] = useState<string | null>(null);
    const toastTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        setWorkspace(loadWorkspaceFromStorage());

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            // This message is not shown in modern browsers, but the event is needed to trigger the prompt.
            const message = 'Are you sure you want to leave? Your unsaved changes will be lost. Use the "Export Workspace" button to save your work.';
            event.preventDefault(); // For modern browsers
            event.returnValue = message; // For older browsers
            return message;
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, []);


    useEffect(() => {
        if (workspace) {
            try {
                localStorage.setItem('clouderaCalculatorWorkspace', JSON.stringify(workspace));
            } catch (error) {
                console.error("Failed to save workspace to localStorage", error);
            }
        }
    }, [workspace]);

    const showToast = (message: string) => {
        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
        setToastMessage(message);
        toastTimeoutRef.current = window.setTimeout(() => {
            setToastMessage(null);
        }, 3000);
    }
    
    const activeSession = useMemo(() => {
        if (!workspace || !workspace.activeSessionId) return null;
        return workspace.sessions.find(s => s.id === workspace.activeSessionId);
    }, [workspace]);

    const updateActiveSession = useCallback((updater: (session: Session) => Session) => {
        setWorkspace(prev => {
            if (!prev || !prev.activeSessionId) return prev;
            const newSessions = prev.sessions.map(s => 
                s.id === prev.activeSessionId ? updater(s) : s
            );
            return { ...prev, sessions: newSessions };
        });
    }, []);

    // Effect for DR <> PROD Y1 Sync
    const prodY1State = activeSession?.appState.environmentsState.prod_y1;
    useEffect(() => {
        if (prodY1State && activeSession?.appState.environmentsState.dr) {
            const drState = activeSession.appState.environmentsState.dr;
            if (JSON.stringify(prodY1State) !== JSON.stringify(drState)) {
                updateActiveSession(session => {
                    const newEnvironmentsState = { ...session.appState.environmentsState };
                    newEnvironmentsState.dr = JSON.parse(JSON.stringify(prodY1State));
                    return {
                        ...session,
                        lastModified: new Date().toISOString(),
                        appState: { ...session.appState, environmentsState: newEnvironmentsState }
                    };
                });
            }
        }
    }, [prodY1State, updateActiveSession, activeSession?.appState.environmentsState.dr]);


    const handleSupportLevelChange = (newLevel: SupportLevel) => {
        updateActiveSession(session => ({
            ...session,
            lastModified: new Date().toISOString(),
            appState: { ...session.appState, supportLevel: newLevel }
        }));
    };
    
    const handleActiveTabChange = (newTabId: string) => {
        updateActiveSession(session => ({
            ...session,
            lastModified: new Date().toISOString(),
            appState: { ...session.appState, activeTab: newTabId }
        }));
    };

    const handleNodeChange = useCallback((envId: string, nodeId: string, field: keyof EnvironmentNode, value: any) => {
        updateActiveSession(session => {
            const newEnvState = { ...session.appState.environmentsState[envId], nodes: session.appState.environmentsState[envId].nodes.map(n => n.id === nodeId ? { ...n, [field]: value } : n) };
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environmentsState: { ...session.appState.environmentsState, [envId]: newEnvState } } };
        });
    }, [updateActiveSession]);

    const handleEnvConfigChange = useCallback((envId: string, field: 'caiUserPack' | 'caiAdminPacks' | 'cemPacks', value: any) => {
        updateActiveSession(session => {
            const newEnvState = { ...session.appState.environmentsState[envId], [field]: value };
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environmentsState: { ...session.appState.environmentsState, [envId]: newEnvState } } };
        });
    }, [updateActiveSession]);

    const handleMonitoredEnvsChange = useCallback((envId: string, selectedIds: string[]) => {
        updateActiveSession(session => {
            const newEnvState = { ...session.appState.environmentsState[envId], monitoredEnvIds: selectedIds };
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environmentsState: { ...session.appState.environmentsState, [envId]: newEnvState } } };
        });
    }, [updateActiveSession]);

    const handleDiskChange = useCallback((envId: string, nodeId: string, diskId: string, field: keyof NodeDisk, value: any) => {
        updateActiveSession(session => {
            const newNodes = session.appState.environmentsState[envId].nodes.map(n => n.id === nodeId ? { ...n, disks: n.disks.map(d => d.id === diskId ? { ...d, [field]: value } : d) } : n);
            const newEnvState = { ...session.appState.environmentsState[envId], nodes: newNodes };
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environmentsState: { ...session.appState.environmentsState, [envId]: newEnvState } } };
        });
    }, [updateActiveSession]);
    
    const handleAddDisk = useCallback((envId: string, nodeId: string) => {
        const newDisk: NodeDisk = { id: crypto.randomUUID(), type: 'ssd', quantity: 1, size: 512, unit: 'GB' };
        updateActiveSession(session => {
            const newNodes = session.appState.environmentsState[envId].nodes.map(n => n.id === nodeId ? { ...n, disks: [...n.disks, newDisk] } : n)
            const newEnvState = { ...session.appState.environmentsState[envId], nodes: newNodes };
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environmentsState: { ...session.appState.environmentsState, [envId]: newEnvState } } };
        });
    }, [updateActiveSession]);
    
    const handleRemoveDisk = useCallback((envId: string, nodeId: string, diskId: string) => {
        updateActiveSession(session => {
            const newNodes = session.appState.environmentsState[envId].nodes.map(n => n.id === nodeId ? { ...n, disks: n.disks.filter(d => d.id !== diskId) } : n);
            const newEnvState = { ...session.appState.environmentsState[envId], nodes: newNodes };
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environmentsState: { ...session.appState.environmentsState, [envId]: newEnvState } } };
        });
    }, [updateActiveSession]);

    const handleReorder = useCallback((envId: string, draggedId: string, targetId: string) => {
        updateActiveSession(session => {
            const nodes = [...session.appState.environmentsState[envId].nodes];
            const draggedIndex = nodes.findIndex(n => n.id === draggedId);
            const targetIndex = nodes.findIndex(n => n.id === targetId);
            if (draggedIndex === -1 || targetIndex === -1) return session;
            const [draggedItem] = nodes.splice(draggedIndex, 1);
            nodes.splice(targetIndex, 0, draggedItem);
            const newOrderedNodes = nodes.map((node, index) => ({...node, order: index}));
            const newEnvState = { ...session.appState.environmentsState[envId], nodes: newOrderedNodes };
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environmentsState: { ...session.appState.environmentsState, [envId]: newEnvState } } };
        });
    }, [updateActiveSession]);
    
    const handleDuplicateNode = useCallback((envId: string, sourceNodeId: string) => {
        updateActiveSession(session => {
            const nodes = [...session.appState.environmentsState[envId].nodes];
            const sourceIndex = nodes.findIndex(n => n.id === sourceNodeId);
            if (sourceIndex === -1) return session;
            const sourceNode = nodes[sourceIndex];
            const newNode: EnvironmentNode = JSON.parse(JSON.stringify(sourceNode));
            newNode.id = crypto.randomUUID();
            newNode.name = `${sourceNode.name} (Copy)`;
            newNode.disks.forEach(disk => { disk.id = crypto.randomUUID(); });
            nodes.splice(sourceIndex + 1, 0, newNode);
            const newOrderedNodes = nodes.map((node, index) => ({ ...node, order: index }));
            const newEnvState = { ...session.appState.environmentsState[envId], nodes: newOrderedNodes };
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environmentsState: { ...session.appState.environmentsState, [envId]: newEnvState } } };
        });
    }, [updateActiveSession]);

    const handleDeleteNode = useCallback((envId: string, nodeIdToDelete: string) => {
        if (!window.confirm("Are you sure you want to delete this custom node?")) return;
        updateActiveSession(session => {
            const newNodes = session.appState.environmentsState[envId].nodes.filter(node => node.id !== nodeIdToDelete).map((node, index) => ({ ...node, order: index }));
            const newEnvState = { ...session.appState.environmentsState[envId], nodes: newNodes };
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environmentsState: { ...session.appState.environmentsState, [envId]: newEnvState } } };
        });
    }, [updateActiveSession]);

    const handleAddNewTab = useCallback(() => {
        updateActiveSession(session => {
            const { envData, envState } = createNewEnvironment('New Environment');
            const newEnvironments = [...session.appState.environments, envData];
            const newEnvironmentsState = { ...session.appState.environmentsState, [envData.id]: envState };
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environments: newEnvironments, environmentsState: newEnvironmentsState, activeTab: envData.id } };
        });
    }, [updateActiveSession]);

    const handleCloneTab = useCallback((sourceEnvId: string) => {
        updateActiveSession(session => {
            const sourceEnv = session.appState.environments.find(e => e.id === sourceEnvId);
            const sourceState = session.appState.environmentsState[sourceEnvId];
            if (!sourceEnv || !sourceState) return session;

            const newId = crypto.randomUUID();
            const newEnvData: EnvironmentData = { ...sourceEnv, id: newId, name: `${sourceEnv.name} (Copy)` };
            const newEnvNodeState: AppState[string] = JSON.parse(JSON.stringify(sourceState));
            const sourceIndex = session.appState.environments.findIndex(e => e.id === sourceEnvId);
            
            const newEnvironments = [...session.appState.environments];
            newEnvironments.splice(sourceIndex + 1, 0, newEnvData);
            const newEnvironmentsState = { ...session.appState.environmentsState, [newId]: newEnvNodeState };

            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environments: newEnvironments, environmentsState: newEnvironmentsState, activeTab: newId } };
        });
    }, [updateActiveSession]);

    const handleDeleteTab = useCallback((envIdToDelete: string) => {
        if (!activeSession || activeSession.appState.environments.length <= 1) return;
        updateActiveSession(session => {
            const newEnvironments = session.appState.environments.filter(e => e.id !== envIdToDelete);
            const newEnvironmentsState = { ...session.appState.environmentsState };
            delete newEnvironmentsState[envIdToDelete];
            const newActiveTab = session.appState.activeTab === envIdToDelete ? (newEnvironments[0]?.id || 'boq') : session.appState.activeTab;
            return { ...session, lastModified: new Date().toISOString(), appState: { ...session.appState, environments: newEnvironments, environmentsState, activeTab: newActiveTab } };
        });
    }, [updateActiveSession, activeSession]);

    const handleUpdateTabName = useCallback((envId: string, newName: string) => {
        updateActiveSession(session => ({
            ...session,
            lastModified: new Date().toISOString(),
            appState: { ...session.appState, environments: session.appState.environments.map(env => env.id === envId ? { ...env, name: newName } : env) }
        }));
    }, [updateActiveSession]);

    // Workspace/Session handlers
    const handleNewSession = () => {
        const newSession = createDefaultSession(`New Calculator ${workspace ? workspace.sessions.length + 1 : 1}`);
        setWorkspace(prev => ({
            ...(prev ?? { sessions: [] }),
            activeSessionId: newSession.id,
            sessions: [...(prev?.sessions ?? []), newSession],
        }));
        showToast("New calculator created!");
    };
    
    const handleSelectSession = (sessionId: string) => {
        setWorkspace(prev => prev ? ({ ...prev, activeSessionId: sessionId }) : prev);
    };

    const handleUpdateSessionName = (sessionId: string, newName: string) => {
        setWorkspace(prev => {
            if (!prev) return prev;
            const newSessions = prev.sessions.map(s => s.id === sessionId ? {...s, name: newName, lastModified: new Date().toISOString()} : s);
            return { ...prev, sessions: newSessions };
        });
        setEditingSessionId(null);
    };
    
    const confirmDeleteSession = (session: Session) => {
        setSessionToDelete(session);
    };

    const executeDeleteSession = () => {
        if (!sessionToDelete || !workspace) return;
        const sessionIdToDelete = sessionToDelete.id;
        const newSessions = workspace.sessions.filter(s => s.id !== sessionIdToDelete);
        
        let newActiveSessionId = workspace.activeSessionId;
        if (newActiveSessionId === sessionIdToDelete) {
            newActiveSessionId = newSessions[0]?.id || null;
        }

        if (newSessions.length === 0) {
            const firstSession = createDefaultSession();
            newSessions.push(firstSession);
            newActiveSessionId = firstSession.id;
        }

        setWorkspace({
            ...workspace,
            activeSessionId: newActiveSessionId,
            sessions: newSessions
        });
        showToast(`'${sessionToDelete.name}' deleted.`);
        setSessionToDelete(null);
    };

    const handleExportWorkspace = useCallback(() => {
        if (!workspace) {
            showToast("No workspace to export.");
            return;
        }
        try {
            const jsonString = JSON.stringify(workspace, null, 2);
            const blob = new Blob([jsonString], { type: "application/json" });
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            const date = new Date().toISOString().slice(0, 10);
            link.download = `cloudera_calculator_backup_${date}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(href);
            showToast("Workspace exported successfully!");
        } catch (error) {
            console.error("Failed to export workspace", error);
            showToast("Error exporting workspace.");
        }
    }, [workspace]);

    const handleImportWorkspace = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result;
            if (typeof text === 'string') {
                setWorkspaceToImport(text);
            }
        };
        reader.onerror = () => {
            showToast("Error reading file.");
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset input so same file can be loaded again
    }, []);
    
    const executeImport = useCallback(() => {
        if (!workspaceToImport) return;
        try {
            const parsed = JSON.parse(workspaceToImport);
            if (!Array.isArray(parsed.sessions)) {
                throw new Error("Invalid format: missing sessions array");
            }

            const importedSessions = parsed.sessions.map((s: Session) => ({
                ...s,
                id: crypto.randomUUID(), // Assign new IDs to prevent collisions
                name: `${s.name} (Imported)`
            }));

            setWorkspace(prev => {
                if (!prev) return null;
                const combinedSessions = [...prev.sessions, ...importedSessions];
                return {
                    ...prev,
                    activeSessionId: importedSessions[0]?.id || prev.activeSessionId,
                    sessions: combinedSessions
                };
            });

            showToast(`${importedSessions.length} calculator(s) imported successfully!`);
        } catch (error) {
            console.error("Failed to import workspace", error);
            showToast("Import failed: Invalid file format.");
        } finally {
            setWorkspaceToImport(null);
        }
    }, [workspaceToImport]);


    const allCalculations = useMemo(() => {
        if (!activeSession) return {};
        const { environments, environmentsState, supportLevel } = activeSession.appState;
        const results: { [envId: string]: { licenseTotals: LicenseTotalsByCategory, displayTotals: DisplayTotals, licenses: CategorizedLicense[] } } = {};
        
        environments.forEach(env => {
            const envState = environmentsState[env.id];
            if (!envState) return;
            const { licenseTotals, displayTotals } = calculateTotals(envState);
            const licenses = calculateLicensesForEnv(licenseTotals, envState, supportLevel);
            results[env.id] = { licenseTotals, displayTotals, licenses };
        });

        const allInitialLicenses = Object.entries(results).reduce((acc, [envId, calc]) => {
            (acc as any)[envId] = calc.licenses;
            return acc;
        }, {} as { [envId: string]: CategorizedLicense[] });

        const licensesWithObs = addObservabilityLicenses(allInitialLicenses, activeSession.appState);

        Object.keys(licensesWithObs).forEach(envId => {
            if (results[envId]) {
                results[envId].licenses = licensesWithObs[envId];
            }
        });

        return results;
    }, [activeSession]);

    if (!workspace || !activeSession) {
        return <div className="bg-cloudera-deep-blue min-h-screen flex items-center justify-center text-white">Loading Workspace...</div>;
    }

    const { environments, environmentsState, activeTab, supportLevel } = activeSession.appState;
    
    const TAB_NAMES: { [key: string]: string } = {
      ...environments.reduce((acc, e) => ({ ...acc, [e.id]: e.name }), {}),
      'boq': 'Bill of Quantities (BoQ)'
    };

    const renderContent = () => {
        if (activeTab === 'boq') {
            const allLicenses = Object.entries(allCalculations).reduce((acc, [envId, calc]) => { (acc as any)[envId] = calc.licenses; return acc; }, {} as { [envId: string]: CalculatedLicenses[] });
            return <BoQTab allCalculatedLicenses={allLicenses} environments={environments} environmentsState={environmentsState} />;
        }
        const envData = environments.find(e => e.id === activeTab);
        if (envData && environmentsState[activeTab] && allCalculations[activeTab]) {
            return <EnvironmentTab envData={envData} envState={environmentsState[activeTab]} onNodeChange={handleNodeChange} onEnvConfigChange={handleEnvConfigChange} onDiskChange={handleDiskChange} onAddDisk={handleAddDisk} onRemoveDisk={handleRemoveDisk} onReorder={handleReorder} onDuplicateNode={handleDuplicateNode} onDeleteNode={handleDeleteNode} calculatedLicenses={allCalculations[activeTab].licenses} displayTotals={allCalculations[activeTab].displayTotals} allEnvironments={environments} onMonitoredEnvsChange={handleMonitoredEnvsChange} />;
        }
        return <div className="p-8 text-center text-gray-400">Please select an environment tab.</div>;
    };
    
    return (
        <div className="min-h-screen bg-cloudera-deep-blue flex">
            <Toast message={toastMessage} />
            {sessionToDelete && <Modal
                title="Delete Session"
                onClose={() => setSessionToDelete(null)}
                onConfirm={executeDeleteSession}
                confirmText="Delete"
                confirmColor="red"
            >
                <p>Are you sure you want to permanently delete the calculator session named <span className="font-bold text-cloudera-orange">"{sessionToDelete.name}"</span>? This action cannot be undone.</p>
            </Modal>}
            {workspaceToImport && <Modal
                title="Import Workspace"
                onClose={() => setWorkspaceToImport(null)}
                onConfirm={executeImport}
                confirmText="Import"
                confirmColor="orange"
            >
                <p>Are you sure you want to import this workspace?</p>
                <p className="mt-2 text-gray-400">This will <span className="font-bold text-white">add</span> the calculators from the file to your current list of workspaces.</p>
            </Modal>}
            <Sidebar 
                workspace={workspace} 
                isOpen={isSidebarOpen}
                onMouseEnter={() => setIsSidebarOpen(true)}
                onMouseLeave={() => setIsSidebarOpen(false)}
                onNewSession={handleNewSession} 
                onSelectSession={handleSelectSession} 
                onDeleteSession={confirmDeleteSession}
                onUpdateSessionName={handleUpdateSessionName}
                editingSessionId={editingSessionId}
                setEditingSessionId={setEditingSessionId}
                onExportWorkspace={handleExportWorkspace}
                onImportWorkspace={handleImportWorkspace}
            />
            <div className={`flex-1 flex flex-col transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-16'}`}>
                <header className="bg-cloudera-deep-blue/50 backdrop-blur-sm shadow-md p-4 sticky top-0 z-20 border-b border-cloudera-accent-blue/20">
                    <div className="container mx-auto flex items-center justify-between">
                        <div className="flex items-center space-x-4 flex-shrink min-w-0">
                           <h1 className="text-2xl font-bold text-gray-50 truncate" title={activeSession.name}>{activeSession.name}</h1>
                        </div>
                        <div>
                            <label htmlFor="support-level-select" className="text-sm text-gray-300 mr-2">Support Level:</label>
                            <select id="support-level-select" value={supportLevel} onChange={e => handleSupportLevelChange(e.target.value as SupportLevel)} className="bg-cloudera-card-bg border border-cloudera-accent-blue/50 rounded-md p-2 text-white focus:ring-1 focus:ring-cloudera-orange">
                                <option value="Standard">Standard</option><option value="Business">Business</option><option value="Business Select">Business Select</option>
                            </select>
                        </div>
                    </div>
                </header>
                <div className="flex-1 flex flex-col">
                  <TabNavigation 
                      environments={environments}
                      activeTab={activeTab}
                      TAB_NAMES={TAB_NAMES}
                      onSetActiveTab={handleActiveTabChange}
                      onAddNewTab={handleAddNewTab}
                      onCloneTab={handleCloneTab}
                      onDeleteTab={handleDeleteTab}
                      onUpdateTabName={handleUpdateTabName}
                  />
                  <main className="container mx-auto flex-1">
                      {renderContent()}
                  </main>
                   <footer className="text-center py-4 mt-8 text-xs text-gray-400">
                      <p>This calculator provides an estimate for discussion purposes only. Contact Cloudera for official pricing.</p>
                  </footer>
                </div>
            </div>
        </div>
    );
};


const Sidebar: React.FC<{
    workspace: Workspace;
    isOpen: boolean;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onNewSession: () => void;
    onSelectSession: (id: string) => void;
    onDeleteSession: (session: Session) => void;
    onUpdateSessionName: (id: string, name: string) => void;
    editingSessionId: string | null;
    setEditingSessionId: (id: string | null) => void;
    onExportWorkspace: () => void;
    onImportWorkspace: (event: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ workspace, isOpen, onMouseEnter, onMouseLeave, onNewSession, onSelectSession, onDeleteSession, onUpdateSessionName, editingSessionId, setEditingSessionId, onExportWorkspace, onImportWorkspace }) => {
    
    const sortedSessions = useMemo(() => 
        [...workspace.sessions].sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()), 
        [workspace.sessions]
    );

    const fileInputRef = useRef<HTMLInputElement>(null);
    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <aside
            className={`bg-cloudera-deep-blue/80 backdrop-blur-lg border-r border-cloudera-accent-blue/20 fixed top-0 left-0 h-full z-30 flex flex-col transition-all duration-300 ${isOpen ? 'w-64' : 'w-16'}`}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className={`p-4 border-b border-cloudera-accent-blue/20 flex items-center ${isOpen ? 'justify-start' : 'justify-center'}`}>
                <img src="https://www.cloudera.com/content/dam/www/marketing/images/logos/cloudera/cloudera-logo@2x.png" alt="Cloudera Logo" className={`transition-all duration-300 ${isOpen ? "h-6 w-auto" : "w-8 h-8 object-contain"}`} />
            </div>
            <div className="p-2">
                <button onClick={onNewSession} className={`w-full flex items-center gap-2 text-sm bg-cloudera-orange hover:bg-orange-500 text-white font-bold py-2 rounded transition-all duration-200 ${isOpen ? 'px-4 justify-start' : 'px-4 justify-center'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
                    <span className={`whitespace-nowrap overflow-hidden transition-all duration-200 ${isOpen ? 'max-w-xs' : 'max-w-0'}`}>New Calculator</span>
                </button>
            </div>
            <nav className={`flex-1 overflow-y-auto p-2 space-y-1 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                {sortedSessions.map(session => (
                    <div key={session.id} className="group relative">
                        {editingSessionId === session.id ? (
                             <input 
                                type="text"
                                defaultValue={session.name}
                                autoFocus
                                onBlur={(e) => onUpdateSessionName(session.id, e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className="w-full text-sm font-medium bg-cloudera-card-bg text-white outline-none ring-2 ring-cloudera-orange rounded px-3 py-2"
                            />
                        ) : (
                             <div 
                                onClick={() => onSelectSession(session.id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectSession(session.id); }}
                                className={`w-full text-left text-sm font-medium flex items-center justify-between p-3 rounded-md transition-colors duration-150 cursor-pointer ${workspace.activeSessionId === session.id ? 'bg-cloudera-orange/20 text-cloudera-orange' : 'text-gray-300 hover:bg-cloudera-accent-blue/20 hover:text-white'}`}
                              >
                                <span className="truncate flex-1">{session.name}</span>
                                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={(e) => { e.stopPropagation(); setEditingSessionId(session.id); }} title="Rename" className="p-1 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg></button>
                                    <button onClick={(e) => { e.stopPropagation(); onDeleteSession(session); }} title="Delete" className="p-1 hover:text-red-400"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1zm4 0a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1z" clipRule="evenodd" /></svg></button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </nav>
            <div className="mt-auto p-2 border-t border-cloudera-accent-blue/20 space-y-1">
                 <button onClick={onExportWorkspace} className={`w-full flex items-center gap-2 text-sm text-gray-300 hover:bg-cloudera-accent-blue/20 hover:text-white p-2 rounded-md transition-all duration-200 ${isOpen ? 'justify-start' : 'justify-center'}`}>
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.707a1 1 0 011.414 0L10 12.001l2.293-2.294a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /><path fillRule="evenodd" d="M10 2a1 1 0 011 1v8a1 1 0 11-2 0V3a1 1 0 011-1z" clipRule="evenodd" /></svg>
                     <span className={`whitespace-nowrap overflow-hidden transition-all duration-200 ${isOpen ? 'max-w-xs' : 'max-w-0'}`}>Export Workspace</span>
                 </button>
                 <button onClick={handleImportClick} className={`w-full flex items-center gap-2 text-sm text-gray-300 hover:bg-cloudera-accent-blue/20 hover:text-white p-2 rounded-md transition-all duration-200 ${isOpen ? 'justify-start' : 'justify-center'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 flex-shrink-0"><path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 3.129a.75.75 0 001.09-1.03l-4.25-4.5a.75.75 0 00-1.09 0l-4.25 4.5a.75.75 0 101.09 1.03L9.25 4.636v8.614z" /><path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" /></svg>
                    <span className={`whitespace-nowrap overflow-hidden transition-all duration-200 ${isOpen ? 'max-w-xs' : 'max-w-0'}`}>Import Workspace</span>
                 </button>
                 <input type="file" ref={fileInputRef} onChange={onImportWorkspace} className="hidden" accept=".json,application/json" />
            </div>
        </aside>
    )
};


const TabNavigation: React.FC<{
    environments: EnvironmentData[],
    activeTab: string,
    TAB_NAMES: { [key: string]: string },
    onSetActiveTab: (id: string) => void,
    onAddNewTab: () => void,
    onCloneTab: (id: string) => void,
    onDeleteTab: (id: string) => void,
    onUpdateTabName: (id: string, name: string) => void,
}> = ({ environments, activeTab, TAB_NAMES, onSetActiveTab, onAddNewTab, onCloneTab, onDeleteTab, onUpdateTabName }) => {
    const [editingTabId, setEditingTabId] = useState<string | null>(null);

    return (
        <nav className="bg-cloudera-deep-blue/50 backdrop-blur-sm border-b border-cloudera-accent-blue/20 sticky top-[80px] z-10">
            <div className="container mx-auto px-4">
                <div className="flex gap-2 overflow-x-auto -mb-px">
                    {environments.map(env => (
                        <div key={env.id} className="group relative flex-shrink-0">
                            {editingTabId === env.id ? (
                                <input type="text" defaultValue={TAB_NAMES[env.id]} autoFocus onBlur={e => { onUpdateTabName(env.id, e.target.value); setEditingTabId(null); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} className="py-3 px-4 text-sm font-medium whitespace-nowrap bg-cloudera-card-bg text-white outline-none ring-2 ring-cloudera-orange" />
                            ) : (
                                <button onClick={() => onSetActiveTab(env.id)} onDoubleClick={() => setEditingTabId(env.id)} className={`py-3 pl-4 pr-10 text-sm font-medium whitespace-nowrap border-b-2 focus:outline-none transition-colors duration-200 ${activeTab === env.id ? 'border-cloudera-orange text-cloudera-orange' : 'border-transparent text-gray-300 hover:text-white hover:border-cloudera-accent-blue/70'}`}>{TAB_NAMES[env.id]}</button>
                            )}
                            <div className="absolute top-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => onCloneTab(env.id)} title="Clone Tab" className="p-1 text-gray-300 hover:text-cloudera-orange"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" /><path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h6a2 2 0 00-2-2H5z" /></svg></button>
                                {environments.length > 1 && (<button onClick={() => onDeleteTab(env.id)} title="Delete Tab" className="p-1 text-gray-300 hover:text-red-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg></button>)}
                            </div>
                        </div>
                    ))}
                    <button onClick={onAddNewTab} title="Add New Environment" className="py-3 px-2 text-gray-400 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg></button>
                    <div key="boq" className="group relative flex items-center flex-shrink-0"><button onClick={() => onSetActiveTab('boq')} className={`py-3 px-4 text-sm font-medium whitespace-nowrap border-b-2 focus:outline-none transition-colors duration-200 ${activeTab === 'boq' ? 'border-cloudera-orange text-cloudera-orange' : 'border-transparent text-gray-300 hover:text-white hover:border-cloudera-accent-blue/70'}`}>{TAB_NAMES['boq']}</button></div>
                </div>
            </div>
        </nav>
    );
};

const Modal: React.FC<{
    title: string;
    children: React.ReactNode;
    onClose: () => void;
    onConfirm: () => void;
    confirmText?: string;
    confirmColor?: 'orange' | 'red';
}> = ({ title, children, onClose, onConfirm, confirmText = "Confirm", confirmColor = 'orange' }) => {
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-cloudera-card-bg rounded-lg shadow-2xl p-6 w-full max-w-md border border-cloudera-accent-blue/30" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold text-cloudera-orange mb-4">{title}</h2>
                <div className="text-gray-300 mb-6">{children}</div>
                <div className="flex justify-end gap-4">
                    <button onClick={onClose} className="px-4 py-2 rounded-md text-gray-200 bg-cloudera-accent-blue/30 hover:bg-cloudera-accent-blue/50 transition-colors">Cancel</button>
                    <button onClick={onConfirm} className={`px-4 py-2 rounded-md font-bold text-white transition-colors ${confirmColor === 'red' ? 'bg-red-600 hover:bg-red-500' : 'bg-cloudera-orange hover:bg-orange-500'}`}>{confirmText}</button>
                </div>
            </div>
        </div>
    );
};

const Toast: React.FC<{ message: string | null }> = ({ message }) => {
    if (!message) return null;
    return (
        <div className="fixed top-5 right-5 bg-cloudera-accent-blue text-white py-2 px-5 rounded-lg shadow-lg z-50 animate-fade-in-out">
            {message}
        </div>
    );
};

export default App;
