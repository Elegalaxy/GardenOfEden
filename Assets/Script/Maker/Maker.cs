using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Maker: MonoBehaviour
{
    //Index 1 = Raw Material, 2 = Firm, 3 = Seller

    string name;
    int id;

    // Produce per service
    int labourNeed, sellPrice, timeNeed;
    Item[] itemNeed;
    Item itemProduce;

    // Work
    int salary; // Basic salary
    int stamNeed; // Basic stamina needed for the job

    public Maker(string n = "", int d = 0, int l = 0, int t = 0, int s = 0, Item[] i = null, int sal = 0, int stam = 0) {
        name = n;
        id = d;

        labourNeed = l;
        timeNeed = t;
        sellPrice = s;
        itemNeed = i;

        salary = sal;
        stamNeed = stam;
    }

    // Get labour
    public int work(Status stat) { // Cost stamina and give salary
        int currStam = stat.get_stamina();
        if(currStam < stamNeed) { // Return if stamina not enough
            Debug.Log("Not enough stamina");
            return 0;
        }

        // Return if work success
        stat.change_stamina(-stamNeed);
        return salary;
    }

    // Sell service
    public Item service(int price) { // Provide price and return product
        if(price < sellPrice) {
            Debug.Log("Not enough money");
            return null;
        }
        return itemProduce;
    }

    public string get_name() {
        return name;
    }
}
