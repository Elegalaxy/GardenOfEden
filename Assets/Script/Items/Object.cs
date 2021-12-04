using System.Collections;
using System.Collections.Generic;

public class Object {
    string name = "", type = "";
    int value = 0, usage = 0;

    public Object(string n = "", string t = "", int v = 0, int u = 0) {
        name = n;
        type = t;
        value = v;
        usage = u;
    }

    //Name
    public string get_name() {
        return name;
    }

    public void set_name(string temp) {
        name = temp;
    }

    //Type
    public string get_type() {
        return type;
    }

    public void set_type(string temp) {
        // !! DON'T ALWAYS CHANGE TYPE !!
        type = temp;
    }

    //Value
    public int get_value() {
        return value;
    }

    public void set_type(int temp) {
        value = temp;
    }

    //Usage
    public int get_usage() {
        return usage;
    }

    public void set_usage(int temp) {
        usage= temp;
    }
}
