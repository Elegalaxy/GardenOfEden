using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Building : MonoBehaviour
{
    // Index 1 = Raw Material, 2 = Firm, 3 = Seller
    public int ind = 0;

    public string name = "";
    public int labourNeed = 0, timeNeed = 0, sellPrice = 0;
    public Item[] itemNeed = { };
    public Item itemProduce = null;

    Maker maker;

    void Start()
    {
        switch(ind){
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
                Debug.Log("Maker type not available");
                break;
        }
    }

    void Update()
    {
        
    }
}
