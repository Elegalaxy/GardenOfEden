using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Building : MonoBehaviour
{
    //Index 1 = Raw Material, 2 = Firm, 3 = Seller

    public string name;
    public int id;

    // Produce per service
    public int labourNeed, timeNeed, sellPrice;
    public Item[] itemNeed;
    public Item itemProduce;

    // Work
    public int salary; // Basic salary
    public int stamNeed; // Basic stamina needed for the job

    Maker maker;

    // Start is called before the first frame update
    void Start()
    {
        switch(id) {
            case 1:
                maker = new RawMat(name, labourNeed, timeNeed, sellPrice, itemNeed);
                gameObject.tag = "RawMaterial";
                break;
            case 2:
                maker = new Firm(name, labourNeed, timeNeed, sellPrice, itemNeed);
                gameObject.tag = "Firm";
                break;
            case 3:
                maker = new Seller(name, labourNeed, timeNeed, sellPrice, itemNeed);
                gameObject.tag = "Seller";
                break;
            default:
                Debug.Log("No id");
                break;
        }
    }

    public Maker get_maker() {
        return maker;
    }
}
