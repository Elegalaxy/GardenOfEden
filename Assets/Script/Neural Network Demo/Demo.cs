using System.Collections;
using System.Collections.Generic;
using System;
//Stop implementation until understand the back progation formula
//dy/dx
//chain rule

    /*
     * By formula or the neural network expression
     * O1 = tanh(bO1)
     * H12 = tanh(bH12)
     * bH22 = (H11*W9 + H12*W10)
     * bH12 = (I1*W4 + 12*H5 + I3*H6)
     * bH22 = (tanh(bH11)*W9 + tanh(bH12)*W10)
     */

    /*
     * Error cost expression
     * [(O1-y1)^2]/2 + [(O2-y2)^2]/2
     */
//using UnityEngine;
//Back-Propagation neural netwoek
public class Demo
{
    int[] layer;
    Layer[] layers;
    public Demo(int[]layer)
    {
        this.layer = new int[layer.Length];
        for (int i = 0; i < layer.Length; i++) {
            this.layer[i] = layer[i];
        }

        layers = new Layer[layer.Length-1];

        for (int i = 0; i < layers.Length; i++)
        {
            layers[i] = new Layer(layer[i], layer[i + 1]);
        }
    }

    public float[] FeedForward(float[] inputs)
    {
        layers[0].FeedForward(inputs);
        for (int i = 1; i < layers.Length; i++)
        {
            layers[i].FeedForward(layers[i - 1].outputs);
        }

        return layers[layers.Length - 1].outputs;
    }

    public class Layer
    {
        int numberOfInputs;// #The number of the previous layer
        int numberOfOutputs;//#The number of thw current layer

        float[] outputs;
        float[] inputs;
        float[,] weights;
        float[,] weightsDelta;
        float[] gamma;
        float[] error;
        public static Random random = new Random();

        public Layer(int numberOfInputs, int numberOfOutputs)
        {
            this.numberOfInputs = numberOfInputs;
            this.numberOfOutputs = numberOfOutputs;

            outputs = new float[numberOfOutputs];
            inputs = new float[numberOfInputs];
            weights = new float[numberOfOutputs, numberOfInputs];
            weightsDelta = new float[numberOfOutputs, numberOfInputs];
            gamma = new float[numberOfOutputs];
            error = new float[numberOfOutputs];

            InitilizeWeights();


        }

        public void InitilizeWeights()
        {
            for(int i = 0; i < numberOfOutputs; i++)
            {
                for(int j = 0; j < numberOfInputs; j++)
                {
                    weights[i, j] = (float)random.NextDouble() - 0.5f;
                }
            }
        }

        public float[] FeedForward(float[] inputs)
        {
            this.inputs = inputs;

            for (int i = 0; i < numberOfOutputs; i++)
            {
                outputs[i] = 0;
                for (int j = 0; j < numberOfInputs; j++)
                {
                    outputs[i] += inputs[j] * weights[i, j];
                }

                outputs[i] = (float)Math.Tanh(outputs[i]);
            }
            return outputs;
        }
    }
}
