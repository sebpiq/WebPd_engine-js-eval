import {
    EngineAttributes,
    EvalDspLoop,
    EvalDspSetup,
} from '@webpd/engine-core/src/types'
import traverseGraph from '@webpd/engine-core/src/traverse-graph'
import * as oscTilde from './nodes/osc~'
import * as dacTilde from './nodes/dac~'
import * as tabplayTilde from './nodes/tabplay~'
import {
    NodeImplementation,
    GlobalNameBuilders,
    JsEvalEngineAttributes,
    PortsNames,
} from './types'
import { ENGINE_ARRAYS_VARIABLE_NAME } from '@webpd/engine-core/src/EvalNode'

export default async (
    graph: PdDspGraph.Graph,
    registry: PdRegistry.Registry,
    settings: EngineAttributes
) => {
    const engineOutputVariableNames: JsEvalEngineAttributes['engineOutputVariableNames'] = []
    for (let channel = 1; channel <= settings.channelCount; channel++) {
        engineOutputVariableNames.push(`ENGINE_OUTPUT${channel}`)
    }
    
    const jsEvalSettings: JsEvalEngineAttributes = {
        ...settings,
        engineOutputVariableNames,
        engineArraysVariableName: ENGINE_ARRAYS_VARIABLE_NAME,
    }

    const { setup, loop } = await generateSetupAndLoop(
        graph,
        registry,
        jsEvalSettings
    )
    
    return `
        ${setup}
        return {
            loop: () => { 
                ${loop}
                return [${engineOutputVariableNames.join(', ')}]
            },
            ports: {
                ${PortsNames.SET_VARIABLE}: (variableName, variableValue) => {
                    eval(variableName + ' = variableValue')
                }
            }
        }
    `
}

export const generateSetupAndLoop = async (
    graph: PdDspGraph.Graph,
    registry: PdRegistry.Registry,
    jsEvalSettings: JsEvalEngineAttributes
): Promise<{ loop: EvalDspLoop; setup: EvalDspSetup }> => {
    const traversal = traverseGraph(graph, registry)
    let setup = ''
    let loop = ''
    for (let node of traversal) {
        const nodeImplementation = nodeImplementations[node.type]
        if (!nodeImplementation) {
            throw new Error(`node ${node.type} is not implemented`)
        }
        const nameBuilders = generateNameBuilders(node)

        setup +=
            '\n' + nodeImplementation.setup(node, nameBuilders, jsEvalSettings)
        loop += nodeImplementation.loop(node, nameBuilders, jsEvalSettings)

        Object.entries(node.sinks).forEach(([outletId, sinkAddresses]) => {
            sinkAddresses.forEach(({ id: sinkNodeId, portlet: inletId }) => {
                loop += `\n${generateInletVariableName(
                    sinkNodeId,
                    inletId
                )} = ${generateOutletVariableName(node.id, outletId)}`
            })
        })
    }
    return Promise.resolve({ setup, loop })
}

const generateNameBuilders = (node: PdDspGraph.Node): GlobalNameBuilders => ({
    ins: generateInletVariableName.bind(this, node.id),
    outs: generateOutletVariableName.bind(this, node.id),
    state: generateStateVariableName.bind(this, node.id),
})

export const generateInletVariableName = (
    nodeId: PdDspGraph.NodeId,
    inletId: PdSharedTypes.PortletId
) => `${nodeId}_INS_${inletId}`

export const generateOutletVariableName = (
    nodeId: PdDspGraph.NodeId,
    outletId: PdSharedTypes.PortletId
) => `${nodeId}_OUTS_${outletId}`

const generateStateVariableName = (
    nodeId: PdDspGraph.NodeId,
    localVariableName: PdSharedTypes.PortletId
) => `${nodeId}_STATE_${localVariableName}`

const nodeImplementations: { [nodeType: string]: NodeImplementation } = {
    'osc~': oscTilde,
    'dac~': dacTilde,
    'tabplay~': tabplayTilde,
}
