using System.Collections;
using System.Collections.Generic;

public class Maker
{
    //Index 1 = Raw Material, 2 = Factory, 3 = Seller

    string name;
    int id;
    int labourNeed;
    float timeNeed;
    //Item[] itemNeed = { };

    public Maker(string n = "", int d = 0, int l = 0, float t = 0f/*, Item[] i = { }*/) {
        name = n;
        id = d;
        labourNeed = l;
        timeNeed = t;
        //itemNeed = i;
    }

}
