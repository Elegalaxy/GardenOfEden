using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Item: MonoBehaviour {
    public string name = "", type = "";
    public int value = 0, usage = 0;

    Object obj;
    
    //Type: Food

    void Start() {
        obj = new Object(name, type, value, usage);
    }

    public Object get_obj() {
        return obj;
    }
}
